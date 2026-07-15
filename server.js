require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { Resend } = require('resend');
const shippingCalculator = require('./shippingCalculator');

// Restart trigger to reload Hostinger environment variables: 2026-05-27-01
const app = express();

// ─── SEO Canonicalization Redirect Middleware ──────────────────────────────
app.use((req, res, next) => {
    const host = req.headers.host || '';
    const url = req.url || '';
    
    let redirectNeeded = false;
    let targetHost = host;
    let targetUrl = url;

    // 1. Strip www. subdomain prefix
    if (host.startsWith('www.')) {
        targetHost = host.slice(4);
        redirectNeeded = true;
    }

    // 2. Redirect index.html to root path /
    const cleanUrl = url.split('?')[0];
    const query = url.split('?')[1] ? '?' + url.split('?')[1] : '';
    if (cleanUrl.endsWith('/index.html') || cleanUrl === '/index.html') {
        const base = cleanUrl.slice(0, -10); // strip 'index.html'
        targetUrl = (base || '/') + query;
        redirectNeeded = true;
    }

    if (redirectNeeded) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        return res.redirect(301, `${protocol}://${targetHost}${targetUrl}`);
    }

    next();
});


// ─── Resend API Client Setup ──────────────────────────────────────────────────
let resend;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Resend connected');
} else {
    console.warn('⚠️  Resend API Key missing. Email features will operate in Simulation Mode.');
}

const PORT = process.env.PORT || 3000;

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

let supabase;
if (supabaseUrl && supabaseKey && supabaseUrl !== 'YOUR_SUPABASE_URL') {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`✅ Supabase connected: ${supabaseUrl}`);
} else {
    console.warn('⚠️  Supabase credentials missing.');
}

// ─── Stripe ──────────────────────────────────────────────────────────────────
let stripe;
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'YOUR_STRIPE_SECRET_KEY') {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe connected');
} else {
    console.warn('⚠️  Stripe credentials missing – payment features disabled.');
}

// ─── Unified Resend Email Dispatcher ─────────────────────────────────────────
async function sendEmail({ to, cc, subject, html, attachments }) {
    if (!resend) {
        console.warn('⚠️ Resend is not initialized. Simulated Email:');
        console.log(`[SIMULATION] To: ${to} | CC: ${cc} | Subject: ${subject}`);
        console.log(`[SIMULATION] Attachments: ${JSON.stringify(attachments || [])}`);
        return { success: false, simulated: true };
    }

    try {
        const fromEmail = process.env.MAIL_FROM || 'onboarding@resend.dev';
        const mailOptions = {
            from: `Nano Neons <${fromEmail}>`,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html
        };

        if (cc) {
            mailOptions.cc = Array.isArray(cc) ? cc : [cc];
        }

        if (attachments && attachments.length > 0) {
            // Map attachments to Resend format
            mailOptions.attachments = await Promise.all(attachments.map(async (att) => {
                let content = att.content;
                
                // If content is a base64 string, convert it to a Buffer
                if (typeof content === 'string' && content.startsWith('data:')) {
                    const matches = content.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
                        content = Buffer.from(matches[2], 'base64');
                    }
                } else if (typeof content === 'string' && !att.path) {
                    content = Buffer.from(content); // e.g. SVG string text
                }

                const resendAttachment = {
                    filename: att.filename
                };

                if (content) {
                    resendAttachment.content = content;
                }
                if (att.path) {
                    resendAttachment.path = att.path;
                }
                if (att.contentType) {
                    resendAttachment.contentType = att.contentType;
                }

                return resendAttachment;
            }));
        }

        const response = await resend.emails.send(mailOptions);
        if (response.error) {
            console.error('❌ Resend API Error:', response.error);
            throw new Error(response.error.message || 'Resend failed to send email');
        }

        console.log('✅ Email sent via Resend successfully:', response.data);
        return { success: true, data: response.data };
    } catch (err) {
        console.error('❌ Failed to send email via Resend:', err.message);
        throw err;
    }
}

// ─── Resend Order Confirmation Dispatcher ────────────────────────────────────
async function sendOrderConfirmationEmail(orderId) {
    if (!supabase) {
        console.warn('⚠️ Supabase not initialized, cannot fetch order details for email.');
        return;
    }

    try {
        console.log(`✉️ Fetching order details to dispatch email for order: ${orderId}`);
        
        // 1. Fetch Order Details from Supabase
        const { data: order, error: orderErr } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            throw new Error(orderErr ? orderErr.message : 'Order not found');
        }

        // 2. Fetch Order Items (with SVG markup) from Supabase
        const { data: items, error: itemsErr } = await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', orderId);

        if (itemsErr || !items) {
            throw new Error(itemsErr ? itemsErr.message : 'Order items not found');
        }

        const emailTo = order.customer_email;
        if (!emailTo) {
            console.warn('⚠️ No customer email found on order, skipping email dispatch.');
            return;
        }

        // 3. Build detailed email confirmation body
        let itemsHtml = '';
        const attachments = [];

        items.forEach((item, index) => {
            itemsHtml += `
                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px; font-family: sans-serif;">
                    <h3 style="margin-top: 0; color: #ff007f; font-size: 1.15rem;">Custom Neon Sign #${index + 1}</h3>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Sign Text:</strong> "${item.text}"</p>
                    <p style="margin: 6px 0; color: #475569;"><strong>Font Name:</strong> ${item.font_name}</p>
                    <p style="margin: 6px 0; color: #475569;"><strong>Color Theme:</strong> ${item.color_name}</p>
                    <p style="margin: 6px 0; color: #475569;"><strong>Dimensions:</strong> ${item.width_cm}cm x ${item.height_cm}cm</p>
                    <p style="margin: 6px 0; color: #475569;"><strong>Backing Material:</strong> ${item.backing}</p>
                    <p style="margin: 6px 0; color: #ff007f; font-weight: 700;"><strong>Price:</strong> $${item.price.toFixed(2)}</p>
                </div>
            `;

            // If there's SVG markup, attach it as a file!
            if (item.svg_markup) {
                attachments.push({
                    filename: `design-custom-sign-${index + 1}.svg`,
                    content: item.svg_markup,
                    contentType: 'image/svg+xml'
                });
            }
        });

        const adminEmail = process.env.MAIL_TO || 'info@nanoneons.com';

        const orderMailHtml = `
            <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #1e1b4b; padding: 20px; background: #ffffff;">
                <div style="text-align: center; padding: 20px 0;">
                    <h2 style="margin: 0; font-weight: 800; font-size: 24px; color: #1e1b4b;">Order Confirmed!</h2>
                    <p style="color: #64748b; margin-top: 5px;">Your digital neon design and order receipt</p>
                </div>
                
                <div style="background: #ff007f; color: #ffffff; padding: 18px 24px; border-radius: 12px; margin-bottom: 30px;">
                    <h3 style="margin: 0; font-size: 16px;">Reference Order ID: <strong>${orderId}</strong></h3>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.95;">Thank you for your order. Your custom neon layout has been sent directly to our neon artisans for handcrafted creation.</p>
                </div>

                <h2 style="font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #f1f5f9; padding-bottom: 8px;">Order Details</h2>
                ${itemsHtml}

                <div style="background: #f1f5f9; border-radius: 12px; padding: 16px 24px; margin-top: 30px;">
                    <p style="margin: 6px 0; color: #475569;"><strong>Customer Name:</strong> ${order.customer_name || 'Valued Customer'}</p>
                    <p style="margin: 6px 0; color: #475569;"><strong>Shipping Address:</strong> ${order.shipping_address || 'Provided in details'}</p>
                    <p style="margin: 6px 0; font-size: 1.1rem; color: #10b981;"><strong>Total Amount Paid:</strong> $${order.total_price.toFixed(2)}</p>
                </div>

                <div style="text-align: center; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 25px; color: #64748b; font-size: 12px;">
                    <p>Questions? Contact our support at info@nanoneons.com</p>
                    <p>&copy; 2026 Nano Neons. All rights reserved.</p>
                </div>
            </div>
        `;

        // Send notification to Admin only
        try {
            await sendEmail({
                to: adminEmail,
                subject: `🔔 [Admin Alert] New Order Placed [Order ID: ${orderId}]`,
                html: `<h3>New Order Received</h3><p>An order confirmation has been generated for ${order.customer_name || 'Customer'}.</p>` + orderMailHtml,
                attachments: attachments
            });
            console.log(`✅ Order notification sent to admin: ${adminEmail}`);
        } catch (adminErr) {
            console.error(`❌ Failed to send order notification to admin: ${adminErr.message}`);
        }

    } catch (err) {
        console.error('❌ Failed to process order email notification:', err);
    }
}

// ─── Resend Quote Request Dispatcher ─────────────────────────────────────────
async function sendQuoteRequestEmail(quoteData, fileBase64, fileName, fileUrl) {
    try {
        const quoteId = quoteData.quote_id;
        const customerEmail = quoteData.email;
        const adminEmail = process.env.MAIL_TO || 'info@nanoneons.com';

        // Build list of colors
        const colorsHtml = quoteData.color 
            ? `<p style="margin: 6px 0; color: #1e1b4b;"><strong>Selected Colors:</strong> ${quoteData.color}</p>`
            : '';

        const attachments = [];
        let imageEmbedHtml = '';

        // ONLY attach file if it is NOT uploaded to Supabase Storage (bypasses Resend 10MB payload limits)
        if (!fileUrl && fileBase64 && fileName) {
            const matches = fileBase64.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                const fileBuffer = Buffer.from(base64Data, 'base64');

                attachments.push({
                    filename: fileName,
                    content: fileBuffer,
                    contentType: mimeType
                });
            }
        }

        if (fileBase64 && fileName) {
            const matches = fileBase64.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
                const mimeType = matches[1];
                if (mimeType.startsWith('image/')) {
                    if (fileUrl) {
                        imageEmbedHtml = `
                            <div style="margin-top: 20px; text-align: center; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; background: #f8fafc;">
                                <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #64748b;">Uploaded Design Preview</p>
                                <img src="${fileUrl}" alt="Customer Uploaded Design" style="max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: contain;">
                            </div>
                        `;
                    } else {
                        imageEmbedHtml = `
                            <div style="margin-top: 20px; text-align: center; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; background: #f8fafc;">
                                <p style="margin: 0 0 10px 0; font-size: 0.9rem; color: #64748b;">Uploaded Design Preview</p>
                                <img src="${fileBase64}" alt="Customer Uploaded Design" style="max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: contain;">
                            </div>
                        `;
                    }
                }
            }
        }

        // Add file download link if URL is available
        const fileUrlHtml = fileUrl
            ? `<p style="margin: 12px 0 6px; color: #1e1b4b;"><strong>Uploaded File URL:</strong> <a href="${fileUrl}" target="_blank" style="color: #ff007f; text-decoration: underline; font-weight: 600;">View & Download Design File</a></p>`
            : '';

        // 1. Email to Admin
        const adminMailSubject = `🎨 New Neon Quote Request [ID: ${quoteId}] - ${quoteData.name}`;
        const adminMailHtml = `
            <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #1e1b4b; padding: 20px; background: #ffffff;">
                <div style="text-align: center; padding: 10px 0; border-bottom: 2px solid #f1f5f9; margin-bottom: 25px;">
                    <h2 style="margin: 0; font-weight: 800; font-size: 22px; color: #ff007f;">New Quote Request Received</h2>
                    <p style="color: #64748b; margin-top: 5px; font-size: 14px;">Reference ID: ${quoteId}</p>
                </div>

                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
                    <h3 style="margin-top: 0; color: #1e1b4b; font-size: 1.1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Customer Information</h3>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Name:</strong> ${quoteData.name}</p>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Email:</strong> <a href="mailto:${customerEmail}" style="color: #00c6fb;">${customerEmail}</a></p>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Phone:</strong> <a href="tel:${quoteData.phone}" style="color: #00c6fb;">${quoteData.phone}</a></p>
                </div>

                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
                    <h3 style="margin-top: 0; color: #ff007f; font-size: 1.1rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Neon Specifications</h3>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Preferred Size:</strong> ${quoteData.size}</p>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Backing Style:</strong> ${quoteData.backing}</p>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Location/Install:</strong> ${quoteData.location}</p>
                    ${colorsHtml}
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Custom Sign Text:</strong> "${quoteData.text || 'None'}"</p>
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>FileName:</strong> ${fileName || 'None'}</p>
                    ${fileUrlHtml}
                    <p style="margin: 6px 0; color: #1e1b4b;"><strong>Instructions / Notes:</strong></p>
                    <p style="margin: 6px 0; padding: 10px; background: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0; color: #475569; font-style: italic;">
                        ${quoteData.notes || 'No extra notes provided.'}
                    </p>
                    ${imageEmbedHtml}
                </div>

                <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
                    <p>This email was automatically generated and sent to you from your website quote form.</p>
                </div>
            </div>
        `;

        // 1. Email to Admin
        try {
            await sendEmail({
                to: adminEmail,
                subject: adminMailSubject,
                html: adminMailHtml,
                attachments: attachments
            });
            console.log(`✅ Quote request notification sent to admin: ${adminEmail}`);
        } catch (adminErr) {
            console.error(`❌ Failed to send quote request email to admin: ${adminErr.message}`);
        }

        // 2. Email to Customer
        try {
            const customerMailSubject = `🎨 Your custom LED Neon quote request [ID: ${quoteId}] is being prepared!`;
            const customerMailHtml = `
                <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif; line-height: 1.6; color: #1e1b4b; padding: 20px; background: #ffffff;">
                    <div style="text-align: center; padding: 10px 0; border-bottom: 2px solid #f1f5f9; margin-bottom: 25px;">
                        <h2 style="margin: 0; font-weight: 800; font-size: 22px; color: #ff007f;">We've Received Your Quote Request!</h2>
                        <p style="color: #64748b; margin-top: 5px; font-size: 14px;">Reference ID: ${quoteId}</p>
                    </div>

                    <p>Hi ${quoteData.name},</p>
                    <p>Thank you for reaching out to Nano Neons. Our design artisans are reviewing your custom LED neon request and will prepare a personalized layout and custom price quote for you shortly.</p>

                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px; margin-top: 20px;">
                        <h3 style="margin-top: 0; color: #1e1b4b; font-size: 1.05rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Request Details</h3>
                        <p style="margin: 6px 0; color: #475569;"><strong>Custom Sign Text:</strong> "${quoteData.text || 'None'}"</p>
                        <p style="margin: 6px 0; color: #475569;"><strong>Preferred Size:</strong> ${quoteData.size}</p>
                        <p style="margin: 6px 0; color: #475569;"><strong>Backing Style:</strong> ${quoteData.backing}</p>
                        ${colorsHtml}
                        ${imageEmbedHtml}
                    </div>

                    <p style="margin-top: 25px;">We usually respond with complete design mockups within **12 to 24 hours**. If you have any additional details or files to share, feel free to reply directly to this email!</p>

                    <p style="margin-top: 30px;">Best regards,<br><strong>Nano Neons Design Team</strong></p>

                    <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
                        <p>Questions? Contact us at <a href="mailto:${adminEmail}" style="color: #ff007f;">${adminEmail}</a></p>
                    </div>
                </div>
            `;

            await sendEmail({
                to: customerEmail,
                subject: customerMailSubject,
                html: customerMailHtml,
                attachments: attachments
            });
            console.log(`✅ Quote confirmation sent to customer: ${customerEmail}`);
        } catch (custErr) {
            console.error(`❌ Failed to send quote confirmation email to customer: ${custErr.message}`);
        }

        console.log(`✉️ Quote request confirmation process completed for ${quoteId}`);
    } catch (err) {
        console.error('❌ Failed to process quote request email notification:', err.message);
    }
}

// Helper to normalize emails (prevents gmail alias dot/plus bypass)
function normalizeEmail(email) {
    if (!email) return '';
    const parts = email.toLowerCase().trim().split('@');
    if (parts.length !== 2) return email.toLowerCase().trim();
    let [local, domain] = parts;
    
    // Gmail / Google Suite normalization
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
        local = local.split('+')[0]; // Remove plus subaddressing
        local = local.replace(/\./g, ''); // Remove all dots
    }
    return `${local}@${domain}`;
}

// Helper to mark order as paid and trigger email notifications once
async function markOrderAsPaid(orderId, sessionId, customerEmail, shippingAddress) {
    if (!supabase || !orderId) return false;

    try {
        // Fetch current order status
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('payment_status')
            .eq('id', orderId)
            .single();

        if (fetchError || !order) {
            console.error(`❌ Failed to fetch order ${orderId} status:`, fetchError?.message);
            return false;
        }

        // If already paid, do not re-send email
        if (order.payment_status === 'paid') {
            console.log(`ℹ️ Order ${orderId} is already marked as paid. Skipping duplicate actions.`);
            return false;
        }

        // Update to paid
        const updateData = {
            payment_status: 'paid',
            stripe_session_id: sessionId,
            customer_email: customerEmail || undefined
        };

        if (shippingAddress) {
            updateData.shipping_address = shippingAddress;
        }

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

        if (updateError) {
            console.error(`❌ Failed to mark order ${orderId} as paid:`, updateError.message);
            return false;
        }

        // If payment succeeded, mark discount as used for this email in their profile
        if (customerEmail) {
            const { error: profileError } = await supabase
                .from('profiles')
                .update({ has_discount_used: true })
                .eq('email', customerEmail.toLowerCase());
            
            if (profileError) {
                console.error(`❌ Failed to update discount status for ${customerEmail}:`, profileError.message);
            } else {
                console.log(`🎁 Profile discount marked as used for ${customerEmail}`);
            }
        }

        console.log(`✅ Order ${orderId} successfully marked as paid.`);
        // Dispatch email notification to admin containing customizer attachment
        sendOrderConfirmationEmail(orderId).catch(err => console.error('Order email dispatcher error:', err));
        return true;
    } catch (err) {
        console.error(`❌ Exception in markOrderAsPaid for order ${orderId}:`, err.message);
        return false;
    }
}

// ─── Stripe Webhook (raw body needed BEFORE json parser) ─────────────────────
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const orderId = session.metadata.order_id;
        const customerEmail = session.customer_details?.email;

        console.log(`💰 Payment confirmed for order: ${orderId}`);

        // Extract validated shipping address from Stripe Checkout
        let shippingAddress = null;
        if (session.shipping_details && session.shipping_details.address) {
            const s = session.shipping_details;
            const a = s.address;
            shippingAddress = `${s.name}\n${a.line1}${a.line2 ? ', ' + a.line2 : ''}\n${a.city}, ${a.state} ${a.postal_code}\n${a.country}`;
        }

        // Mark order as paid in Supabase
        if (supabase && orderId) {
            await markOrderAsPaid(orderId, session.id, customerEmail, shippingAddress);
        }
    }

    res.json({ received: true });
});

// ─── JSON body parser (after webhook route) ───────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve clean SEO URLs locally
app.get('/programmable-led-sign', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'programmable-led-sign.html'));
});
app.get('/channel-letters', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'channel-letters.html'));
});
app.get('/storefront-signs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storefront-signs.html'));
});
app.get('/backlit-sign', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'backlit-sign.html'));
});
app.get('/gallery', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// Dynamic routing for World Cup country SEO pages
app.get('/world-cup/:country', (req, res) => {
    const country = req.params.country.toLowerCase();
    const filePath = path.join(__dirname, 'public', `world-cup-${country}.html`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
});

// ─── Static files (with cache headers for performance) ────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        const basename = path.basename(filePath);
        // HTML files should never be cached so updates are picked up immediately
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        // SEO-critical files should be short-cached so crawlers always get fresh versions
        if (basename === 'robots.txt' || basename === 'sitemap.xml' || basename === 'llms.txt') {
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        }
    }
}));

// ─── API: Expose Client Supabase Config ───────────────────────────────────────
app.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
        supabaseUrl: process.env.SUPABASE_URL || null,
        supabaseKey: process.env.SUPABASE_KEY || null
    });
});

// ─── API: Verify Payment (called by confirmation page after Stripe redirects) ──
app.get('/api/verify-payment', async (req, res) => {
    const { session_id, order_id } = req.query;
    if (!stripe || !session_id) return res.json({ paid: false });

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        const paid = session.payment_status === 'paid';

        if (paid && supabase && order_id) {
            // Extract validated shipping address from Stripe Checkout
            let shippingAddress = null;
            if (session.shipping_details && session.shipping_details.address) {
                const s = session.shipping_details;
                const a = s.address;
                shippingAddress = `${s.name}\n${a.line1}${a.line2 ? ', ' + a.line2 : ''}\n${a.city}, ${a.state} ${a.postal_code}\n${a.country}`;
            }

            await markOrderAsPaid(order_id, session_id, session.customer_details?.email, shippingAddress);
            console.log(`✅ Order ${order_id} verified and checked for payment mark`);
        }

        res.json({ paid, customerEmail: session.customer_details?.email });
    } catch (err) {
        console.error('Verify payment error:', err.message);
        res.json({ paid: false });
    }
});

// ─── API: Create Stripe Checkout Session ──────────────────────────────────────
// ─── API: Calculate Shipping Rates ───────────────────────────────────────────
app.post('/api/shipping-rates', (req, res) => {
    const { items, zipCode, residential, liftgate } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty.' });
    }

    try {
        const rates = shippingCalculator.calculateShippingRates(items, zipCode, {
            residential: residential ?? true,
            liftgate: liftgate ?? false
        });
        res.json({ rates });
    } catch (err) {
        console.error('Failed to calculate shipping rates:', err);
        res.status(500).json({ error: err.message || 'Failed to calculate rates' });
    }
});

// ─── API: Create Stripe Checkout Session ──────────────────────────────────────
app.post('/api/create-checkout', async (req, res) => {
    if (!stripe) return res.status(500).json({ error: 'Payment system not configured.' });
    if (!supabase) return res.status(500).json({ error: 'Database not configured.' });

    const { customer_name, customer_email, shipping_address, items, total_price, shipping_method_id, residential, liftgate } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Cart is empty.' });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!customer_email || !emailRegex.test(customer_email.trim())) {
        return res.status(400).json({ error: 'Please enter a valid email address (e.g., name@example.com).' });
    }

    try {
        // Calculate verified shipping rates on the backend to prevent pricing fraud
        const zipCodeMatch = (shipping_address || '').match(/\b\d{5}(-\d{4})?\b/);
        const zipCode = zipCodeMatch ? zipCodeMatch[0].substring(0, 5) : '';
        
        const rates = shippingCalculator.calculateShippingRates(items, zipCode, {
            residential: residential ?? true,
            liftgate: liftgate ?? false
        });

        const selectedRate = rates.find(r => r.id === shipping_method_id) || rates[0] || { id: 'local_pickup', name: 'Free Local Pickup', price: 0 };
        const shipping_price = selectedRate.price;
        const shipping_method = selectedRate.name;

        // Check if user is eligible for a 15% discount
        let appliedDiscount = false;
        let finalTotalPrice = total_price;

        if (customer_email) {
            const normalizedEmail = normalizeEmail(customer_email);

            // Read the Authorization header to verify Supabase session token
            const authHeader = req.headers.authorization;
            let authenticatedUser = null;

            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                try {
                    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
                    if (user && !authErr) {
                        authenticatedUser = user;
                    }
                } catch (e) {
                    console.error('Error verifying auth token:', e.message);
                }
            }

            // ONLY apply discount if user is fully authenticated and matches the checkout email!
            if (authenticatedUser && authenticatedUser.email.toLowerCase() === customer_email.toLowerCase()) {
                try {
                    // Check if email is verified in Supabase
                    const { data: isVerified } = await supabase
                        .rpc('is_email_verified', { email_to_check: customer_email.toLowerCase() });

                    if (isVerified) {
                        // Check if the normalized email has already used the discount
                        const { data: profiles } = await supabase
                            .from('profiles')
                            .select('id, has_discount_used')
                            .eq('normalized_email', normalizedEmail);

                        if (profiles && profiles.length > 0) {
                            const alreadyUsed = profiles.some(p => p.has_discount_used);
                            if (!alreadyUsed) {
                                appliedDiscount = true;
                                finalTotalPrice = Math.round(total_price * 0.85 * 100) / 100;
                                console.log(`🔒 [SECURE DISCOUNT] Applied 15% discount for verified user: ${customer_email}`);
                            } else {
                                console.log(`🔒 [SECURE DISCOUNT] Blocked discount for ${customer_email}: already used on normalized alias.`);
                            }
                        }
                    } else {
                        console.log(`🔒 [SECURE DISCOUNT] Blocked discount for ${customer_email}: email is not verified.`);
                    }
                } catch (err) {
                    console.error('Security discount check error:', err.message);
                }
            } else {
                console.log(`🔒 [SECURE DISCOUNT] No discount applied: guest checkout or token mismatch for ${customer_email}`);
            }
        }

        // Grand total includes subtotal (potentially discounted) + shipping price
        const grandTotalPrice = Math.round((finalTotalPrice + shipping_price) * 100) / 100;

        // 1. Save a PENDING order to Supabase first
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([{
                customer_name,
                customer_email,
                shipping_address,
                total_price: grandTotalPrice,
                payment_status: 'pending',
                shipping_price,
                shipping_method
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        // 2. Save order items (unrolling quantities into individual database rows)
        const orderItems = [];
        items.forEach(item => {
            let itemPrice = item.price;
            if (appliedDiscount) {
                itemPrice = Math.round(itemPrice * 0.85 * 100) / 100;
            }
            const qty = item.quantity || 1;
            for (let i = 0; i < qty; i++) {
                orderItems.push({
                    order_id: order.id,
                    text: item.text,
                    font_name: item.fontName,
                    color_name: item.colorName,
                    width_cm: item.widthCm,
                    height_cm: item.heightCm,
                    backing: `${item.backing === 'cut-to-letter' ? 'Cut to Letter' : item.backing === 'rectangle' ? 'Rectangle' : 'Cut to Shape'} (${item.backingColor === 'black' ? 'Black Acrylic' : item.backingColor === 'white' ? 'White Acrylic' : 'Clear Glass'}, ${item.environment === 'outdoor' ? 'Outdoor Waterproof' : 'Indoor Use'})`,
                    price: itemPrice,
                    svg_markup: item.svgMarkup
                });
            }
        });

        const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItems);

        if (itemsError) throw itemsError;

        // 3. Build Stripe line items
        const lineItems = items.map(item => {
            let unitPrice = item.price;
            if (appliedDiscount) {
                unitPrice = Math.round(unitPrice * 0.85 * 100) / 100;
            }
            return {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `Neon Sign — "${item.text}"` + (appliedDiscount ? ' (15% Member Discount Applied)' : ''),
                        description: `${item.fontName} · ${item.colorName} · ${item.widthIn || Math.round(item.widthCm / 2.54)}in x ${item.heightIn || Math.round(item.heightCm / 2.54)}in (${item.widthCm}×${item.heightCm}cm) · ${item.backing === 'cut-to-letter' ? 'Cut to Letter' : item.backing === 'rectangle' ? 'Rectangle' : 'Cut to Shape'} · ${item.backingColor === 'black' ? 'Black Acrylic' : item.backingColor === 'white' ? 'White Acrylic' : 'Clear Glass'} · ${item.environment === 'outdoor' ? 'Outdoor Waterproof' : 'Indoor Use'}`
                    },
                    unit_amount: Math.round(unitPrice * 100) // Stripe expects cents
                },
                quantity: item.quantity || 1
            };
        });

        // 4. Create Stripe Checkout Session
        const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
        
        const sessionOptions = {
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            customer_email: customer_email || undefined,
            shipping_address_collection: {
                allowed_countries: ['US']
            },
            automatic_tax: {
                enabled: true
            },
            metadata: {
                order_id: order.id,
                customer_name: customer_name || '',
                discount_applied: appliedDiscount ? 'true' : 'false',
                customer_email: customer_email || ''
            },
            success_url: `${origin}/confirmation.html?id=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/cart.html`
        };

        // Add calculated shipping rate to Stripe sessionOptions
        if (selectedRate.id !== 'local_pickup') {
            sessionOptions.shipping_options = [
                {
                    shipping_rate_data: {
                        type: 'fixed_amount',
                        fixed_amount: {
                            amount: Math.round(shipping_price * 100),
                            currency: 'usd',
                        },
                        display_name: shipping_method,
                        delivery_estimate: {
                            minimum: {
                                unit: 'business_day',
                                value: selectedRate.minDays || 1,
                            },
                            maximum: {
                                unit: 'business_day',
                                value: selectedRate.maxDays || 5,
                            },
                        }
                    },
                }
            ];
        } else {
            sessionOptions.shipping_options = [
                {
                    shipping_rate_data: {
                        type: 'fixed_amount',
                        fixed_amount: {
                            amount: 0,
                            currency: 'usd',
                        },
                        display_name: 'Free Local Pickup',
                        delivery_estimate: {
                            minimum: {
                                unit: 'business_day',
                                value: 1,
                            },
                            maximum: {
                                unit: 'business_day',
                                value: 1,
                            }
                        }
                    }
                }
            ];
        }

        const session = await stripe.checkout.sessions.create(sessionOptions);

        res.json({ url: session.url });

    } catch (err) {
        console.error('Checkout session error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── API: Save Order (legacy / fallback without Stripe) ───────────────────────
app.post('/api/orders', async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Database not configured.' });

    const { customer_name, customer_email, shipping_address, items, total_price } = req.body;

    try {
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([{ customer_name, customer_email, shipping_address, total_price, payment_status: 'free' }])
            .select()
            .single();

        if (orderError) throw orderError;

        const orderItems = items.map(item => ({
            order_id: order.id,
            text: item.text,
            font_name: item.fontName,
            color_name: item.colorName,
            width_cm: item.widthCm,
            height_cm: item.heightCm,
            backing: item.backing,
            price: item.price,
            svg_markup: item.svgMarkup
        }));

        const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
        if (itemsError) throw itemsError;

        // Dispatch email confirmation asynchronously with design attachments
        sendOrderConfirmationEmail(order.id).catch(err => console.error('Email dispatcher error:', err));

        res.json({ success: true, orderId: order.id });
    } catch (err) {
        console.error('Order submission error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── API: Submit Quote Request ────────────────────────────────────────────────
app.post('/api/quote', async (req, res) => {
    try {
        const { name, email, phone, text, color, size, backing, location, notes, fileBase64, fileName } = req.body;
        
        console.log('Received Quote Request:', { name, email, phone, text, color, size, backing, location });

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email.trim())) {
            return res.status(400).json({ success: false, error: 'Please enter a valid email address (e.g., name@example.com).' });
        }

        // Phone format validation (must contain at least 10 digits)
        const phoneDigits = (phone || '').replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 15) {
            return res.status(400).json({ success: false, error: 'Please enter a valid phone number with at least 10 digits.' });
        }

        let quoteId = 'Q-' + Math.floor(100000 + Math.random() * 900000);

        if (!supabase) {
            console.error('❌ Supabase not configured on the hosting server.');
            return res.status(500).json({ success: false, error: 'Database connection is missing. Supabase environment variables (SUPABASE_URL and SUPABASE_KEY) are not configured on your Hostinger server.' });
        }

        try {
            let fileUrl = null;

            // Upload design file to Supabase Storage if provided
            if (fileBase64 && fileName) {
                try {
                    // Extract the mime type and raw base64 data
                    const matches = fileBase64.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
                        const mimeType = matches[1];
                        const base64Data = matches[2];
                        const fileBuffer = Buffer.from(base64Data, 'base64');

                        // Create a unique file path: quote-id/original-filename
                        const storagePath = `${quoteId}/${fileName}`;

                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('quote-uploads')
                            .upload(storagePath, fileBuffer, {
                                contentType: mimeType,
                                upsert: false
                            });

                        if (uploadError) {
                            console.warn('⚠️ Storage upload failed:', uploadError.message);
                        } else {
                            // Get the public URL for the uploaded file
                            const { data: urlData } = supabase.storage
                                .from('quote-uploads')
                                .getPublicUrl(storagePath);

                            fileUrl = urlData.publicUrl;
                            console.log('✅ Design file uploaded to Storage:', fileUrl);
                        }
                    }
                } catch (uploadErr) {
                    console.warn('⚠️ File upload exception (non-blocking):', uploadErr.message);
                }
            }

            // Insert quote into database with clickable file URL instead of raw base64
            const { error } = await supabase
                .from('quote_requests')
                .insert([{
                    quote_id: quoteId,
                    name,
                    email,
                    phone,
                    text,
                    color,
                    size,
                    backing,
                    location,
                    notes,
                    file_name: fileName,
                    file_data: fileUrl  // Now stores a clickable public URL instead of base64
                }]);

            if (error) {
                console.error('❌ Supabase quote_requests insert error:', error.message);
                return res.status(500).json({ success: false, error: error.message });
            }
            
            console.log('✅ Quote saved to Supabase:', quoteId);

            // Dispatch email notification asynchronously (attaching design file)
            sendQuoteRequestEmail(
                { quote_id: quoteId, name, email, phone, text, color, size, backing, location, notes },
                fileBase64,
                fileName,
                fileUrl
            ).catch(err => console.error('Quote email dispatcher error:', err));

        } catch (dbErr) {
            console.error('❌ Database exception during quote insert:', dbErr.message);
            return res.status(500).json({ success: false, error: dbErr.message });
        }

        res.json({ success: true, quoteId });
    } catch (err) {
        console.error('Quote submission API error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── 404 NOT FOUND HANDLER ───────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Neon Sign Creator running at http://localhost:${PORT}\n`);
    });
}

module.exports = app;
