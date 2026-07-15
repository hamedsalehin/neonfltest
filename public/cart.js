document.addEventListener('DOMContentLoaded', () => {
    const cart = JSON.parse(localStorage.getItem('neon_cart')) || [];
    
    const cartList = document.getElementById('cart-page-items-list');
    const subtotalEl = document.getElementById('page-subtotal');
    const totalEl = document.getElementById('page-total');
    const countTitle = document.getElementById('item-count-title');
    const placeOrderBtn = document.getElementById('place-order-btn');

    let selectedShippingRate = null;
    let currentRates = [];
    let lastZipCode = '';

    // Check if any cart item is heavy or oversized (LTL Freight)
    const checkIfFreightEligible = () => {
        let totalWeight = 0;
        let hasFreightItem = false;
        let maxSingleDimension = 0;

        cart.forEach(item => {
            const title = (item.productTitle || item.text || "").toLowerCase();
            let width = parseFloat(item.widthIn);
            let height = parseFloat(item.heightIn);
            let areaSqFt = 1;

            if (isNaN(width) || isNaN(height)) {
                // Try parsing from size string or use widthCm/heightCm
                const sizeStr = item.size || "";
                const clean = sizeStr.replace(/\\/g, "").replace(/"/g, "").replace(/”/g, "").replace(/’/g, "'").trim();
                const parts = clean.split(/x|\*|by/i).map(p => p.trim());
                if (parts.length >= 2) {
                    const w = parseFloat(parts[0]);
                    const h = parseFloat(parts[1]);
                    const isWFeet = parts[0].includes("'") || parts[0].toLowerCase().includes("ft");
                    const isHFeet = parts[1].includes("'") || parts[1].toLowerCase().includes("ft");
                    width = isWFeet ? w * 12 : w;
                    height = isHFeet ? h * 12 : h;
                } else if (item.widthCm && item.heightCm) {
                    width = Math.round(item.widthCm / 2.54);
                    height = Math.round(item.heightCm / 2.54);
                } else {
                    width = 12;
                    height = 12;
                }
            }
            areaSqFt = (width * height) / 144;

            let weightLbs = 1.0;
            let isFreight = false;
            let lengthInches = Math.max(width, height);
            let widthInches = Math.min(width, height);
            let heightInches = 1.0;

            if (title.includes("neon") || title.includes("cup") || title.includes("sign")) {
                weightLbs = Math.max(3.0, areaSqFt * 1.6);
                lengthInches = Math.max(width, height) + 2;
                widthInches = Math.min(width, height) + 2;
                heightInches = 2.5;
            } else if (title.includes("banner")) {
                if (title.includes("retractable") || title.includes("roll up") || title.includes("roll-up")) {
                    weightLbs = 12.0;
                    lengthInches = 36.0;
                    widthInches = 6.0;
                    heightInches = 6.0;
                } else {
                    const multiplier = title.includes("fabric") ? 0.07 : 0.11;
                    weightLbs = Math.max(1.0, areaSqFt * multiplier);
                    lengthInches = Math.max(12, lengthInches);
                    widthInches = Math.max(6, widthInches / 4);
                    heightInches = 4.0;
                }
            } else if (title.includes("tent") || title.includes("canopy")) {
                weightLbs = 48.0;
                lengthInches = 62.0;
                widthInches = 10.0;
                heightInches = 10.0;
                isFreight = true;
            } else if (title.includes("a-frame")) {
                weightLbs = 22.0;
                lengthInches = 42.0;
                widthInches = 26.0;
                heightInches = 5.0;
            }

            const girth = lengthInches + 2 * (widthInches + heightInches);
            if (weightLbs > 150 || lengthInches > 96 || girth > 130) {
                isFreight = true;
            }

            const qty = item.quantity || 1;
            totalWeight += weightLbs * qty;
            if (isFreight) {
                hasFreightItem = true;
            }

            const itemMaxDim = Math.max(lengthInches, widthInches);
            if (itemMaxDim > maxSingleDimension) {
                maxSingleDimension = itemMaxDim;
            }
        });

        if (totalWeight > 150 || maxSingleDimension > 96) {
            hasFreightItem = true;
        }

        return hasFreightItem;
    };

    // Extract 5-digit ZIP code from the address field
    const getZipCode = () => {
        const addressVal = document.getElementById('cust-address')?.value || '';
        const zipCodeMatch = addressVal.match(/\b\d{5}(-\d{4})?\b/);
        return zipCodeMatch ? zipCodeMatch[0].substring(0, 5) : '';
    };

    // Hide shipping options and reset totals
    const hideShippingMethodBox = () => {
        const shippingBox = document.getElementById('shipping-method-box');
        if (shippingBox) shippingBox.style.display = 'none';
        
        selectedShippingRate = null;
        currentRates = [];
        
        const shippingEl = document.getElementById('page-shipping');
        if (shippingEl) shippingEl.textContent = 'Calculated at address';
        
        const taxEl = document.getElementById('page-tax');
        if (taxEl) taxEl.textContent = '$0.00';
        
        const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
        if (totalEl) totalEl.textContent = `$${subtotal.toFixed(2)}`;
    };

    // Update the UI summary totals
    const updateSummaryTotals = () => {
        const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);
        const shippingPrice = selectedShippingRate ? selectedShippingRate.price : 0;
        
        // Florida Tax: 7% if zip code starts with 32, 33, 34
        const zipCode = getZipCode();
        const isFL = zipCode.startsWith('32') || zipCode.startsWith('33') || zipCode.startsWith('34');
        const taxRate = isFL ? 0.07 : 0.00;
        const taxPrice = Math.round((subtotal * taxRate) * 100) / 100;

        const total = subtotal + shippingPrice + taxPrice;

        const shippingEl = document.getElementById('page-shipping');
        if (shippingEl) {
            if (selectedShippingRate) {
                shippingEl.textContent = shippingPrice === 0 ? 'Free' : `$${shippingPrice.toFixed(2)}`;
            } else {
                shippingEl.textContent = 'Calculated at address';
            }
        }

        const taxEl = document.getElementById('page-tax');
        if (taxEl) {
            taxEl.textContent = `$${taxPrice.toFixed(2)}`;
        }

        if (totalEl) {
            totalEl.textContent = `$${total.toFixed(2)}`;
        }
    };

    // Render the shipping rate selector card elements
    const renderRatesList = () => {
        const ratesListEl = document.getElementById('shipping-rates-list');
        if (!ratesListEl) return;
        ratesListEl.innerHTML = '';

        currentRates.forEach(rate => {
            const isSelected = selectedShippingRate && selectedShippingRate.id === rate.id;
            const card = document.createElement('div');
            card.className = `shipping-rate-card${isSelected ? ' selected' : ''}`;
            card.style.position = 'relative';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            card.style.padding = '16px';
            card.style.border = isSelected ? '2px solid #ff007f' : '2px solid rgba(0, 0, 0, 0.08)';
            card.style.borderRadius = '16px';
            card.style.cursor = 'pointer';
            card.style.background = isSelected ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.5)';
            card.style.boxShadow = isSelected ? '0 8px 20px rgba(255, 0, 127, 0.08)' : 'none';

            card.innerHTML = `
                <div class="shipping-rate-info" style="display: flex; align-items: flex-start; gap: 12px;">
                    <input type="radio" name="shipping-rate-select" value="${rate.id}" ${isSelected ? 'checked' : ''} style="accent-color: #ff007f; transform: scale(1.2); cursor: pointer; margin-top: 4px;">
                    <div class="shipping-rate-details" style="display: flex; flex-direction: column; gap: 2px;">
                        <span class="shipping-rate-name" style="font-weight: 700; font-size: 0.95rem; color: #1e1b4b;">${rate.name}</span>
                        <span class="shipping-rate-desc" style="font-size: 0.78rem; color: #475569; line-height: 1.3;">${rate.deliveryEstimate} — ${rate.description}</span>
                    </div>
                </div>
                <span class="shipping-rate-price" style="font-weight: 800; font-size: 1.1rem; color: #ff007f;">${rate.price === 0 ? 'Free' : `$${rate.price.toFixed(2)}`}</span>
            `;

            card.addEventListener('click', () => {
                const radio = card.querySelector('input[type="radio"]');
                if (radio) radio.checked = true;

                selectedShippingRate = rate;
                renderRatesList();
                updateSummaryTotals();
            });

            const radio = card.querySelector('input[type="radio"]');
            if (radio) {
                radio.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectedShippingRate = rate;
                    renderRatesList();
                    updateSummaryTotals();
                });
            }

            ratesListEl.appendChild(card);
        });
    };

    // Fetch shipping rates from backend API
    const fetchShippingRates = async () => {
        const zipCode = getZipCode();
        if (!zipCode || zipCode.length < 5) {
            hideShippingMethodBox();
            return;
        }

        const isFreight = checkIfFreightEligible();

        const freightContainer = document.getElementById('freight-options-container');
        if (freightContainer) {
            freightContainer.style.display = isFreight ? 'block' : 'none';
        }

        const residential = isFreight ? (document.getElementById('freight-residential')?.checked !== false) : true;
        const liftgate = isFreight ? (document.getElementById('freight-liftgate')?.checked || false) : false;

        const ratesListEl = document.getElementById('shipping-rates-list');
        if (ratesListEl) {
            ratesListEl.innerHTML = '<div style="font-size: 0.9rem; color: #475569; padding: 12px 0;">⏳ Calculating shipping rates...</div>';
        }
        
        const shippingBox = document.getElementById('shipping-method-box');
        if (shippingBox) shippingBox.style.display = 'block';

        try {
            const response = await fetch('/api/shipping-rates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: cart,
                    zipCode,
                    residential,
                    liftgate
                })
            });

            const data = await response.json();
            if (data.rates && data.rates.length > 0) {
                currentRates = data.rates;
                
                // Keep selection or default to first rate
                let rateToSelect = currentRates.find(r => r.id === (selectedShippingRate?.id)) || currentRates[0];
                selectedShippingRate = rateToSelect;

                renderRatesList();
                updateSummaryTotals();
            } else {
                if (ratesListEl) {
                    ratesListEl.innerHTML = '<div style="font-size: 0.9rem; color: #ef4444; padding: 12px 0;">❌ Failed to load shipping options.</div>';
                }
            }
        } catch (err) {
            console.error('Fetch shipping rates error:', err);
            if (ratesListEl) {
                ratesListEl.innerHTML = '<div style="font-size: 0.9rem; color: #ef4444; padding: 12px 0;">❌ Error calculating rates.</div>';
            }
        }
    };

    // Render Cart items
    const renderCart = () => {
        if (cart.length === 0) {
            cartList.innerHTML = '<div class="empty-cart-msg" style="font-size: 1.2rem; padding: 40px;">Your cart is empty. <a href="customizer.html" style="color: var(--accent-color);">Start designing!</a></div>';
            subtotalEl.textContent = '$0.00';
            totalEl.textContent = '$0.00';
            countTitle.textContent = 'Your cart is currently empty.';
            if (placeOrderBtn) placeOrderBtn.disabled = true;
            hideShippingMethodBox();
            return;
        }

        const totalQty = cart.reduce((sum, item) => sum + (item.quantity || 1), 0);
        countTitle.textContent = `You have ${totalQty} item${totalQty === 1 ? '' : 's'} in your cart.`;
        cartList.innerHTML = '';
        let subtotal = 0;

        cart.forEach((item, index) => {
            const qty = item.quantity || 1;
            subtotal += item.price * qty;
            const itemEl = document.createElement('div');
            itemEl.className = 'cart-page-item';
            itemEl.innerHTML = `
                <div class="cart-page-item-img">
                    ${item.svgMarkup}
                </div>
                <div class="cart-page-item-info">
                    <div class="cart-page-item-name">${item.text.replace(/\n/g, ' ')}</div>
                    <div class="cart-page-item-details">
                        <strong>Font:</strong> ${item.fontName}<br>
                        <strong>Color:</strong> ${item.colorName}<br>
                        <strong>Size:</strong> ${item.widthIn || Math.round(item.widthCm / 2.54)}in x ${item.heightIn || Math.round(item.heightCm / 2.54)}in / ${item.widthCm}cm x ${item.heightCm}cm<br>
                        <strong>Backing:</strong> ${item.backing === 'cut-to-letter' ? 'Cut to Letter' : item.backing === 'rectangle' ? 'Rectangle' : 'Cut to Shape'}<br>
                        <strong>Material:</strong> ${item.backingColor === 'black' ? 'Black Acrylic' : item.backingColor === 'white' ? 'White Acrylic' : 'Clear Glass'}<br>
                        <strong>Use:</strong> ${item.environment === 'outdoor' ? 'Outdoor (Waterproof)' : 'Indoor'}
                    </div>
                    <div class="cart-page-item-price" style="display: flex; align-items: baseline; gap: 8px; margin-top: 8px;">
                        <span style="font-size: 1.25rem; font-weight: 700; color: #10b981;">$${(item.price * qty).toFixed(2)}</span>
                        ${qty > 1 ? `<span style="font-size: 0.8rem; color: #64748b; font-weight: normal;">($${item.price.toFixed(2)} each)</span>` : ''}
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 14px;">
                        <span style="font-size: 0.85rem; color: #475569; font-weight: 500;">Quantity:</span>
                        <div class="qty-control" style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.1); border-radius: 6px; padding: 2px 6px; width: fit-content;">
                            <button class="qty-btn dec-qty-btn" data-index="${index}" style="background: transparent; border: none; color: #1e1b4b; cursor: pointer; width: 22px; height: 22px; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 1rem; padding: 0;">-</button>
                            <span class="qty-val" style="font-size: 0.9rem; font-weight: 600; min-width: 20px; text-align: center; color: #1e1b4b;">${qty}</span>
                            <button class="qty-btn inc-qty-btn" data-index="${index}" style="background: transparent; border: none; color: #1e1b4b; cursor: pointer; width: 22px; height: 22px; font-weight: bold; display: flex; align-items: center; justify-content: center; font-size: 1rem; padding: 0;">+</button>
                        </div>
                    </div>
                </div>
                <button class="remove-item-btn" data-index="${index}">
                    Remove
                </button>
            `;
            cartList.appendChild(itemEl);
        });

        subtotalEl.textContent = `$${subtotal.toFixed(2)}`;

        // Re-calculate shipping if zip is present
        const zip = getZipCode();
        if (zip && zip.length >= 5) {
            fetchShippingRates();
        } else {
            hideShippingMethodBox();
        }

        // Add remove listeners
        document.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                cart.splice(idx, 1);
                localStorage.setItem('neon_cart', JSON.stringify(cart));
                renderCart();
            });
        });

        // Add quantity listeners
        document.querySelectorAll('.dec-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                const qty = cart[idx].quantity || 1;
                if (qty > 1) {
                    cart[idx].quantity = qty - 1;
                } else {
                    cart.splice(idx, 1);
                }
                localStorage.setItem('neon_cart', JSON.stringify(cart));
                renderCart();
            });
        });

        document.querySelectorAll('.inc-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                const qty = cart[idx].quantity || 1;
                cart[idx].quantity = qty + 1;
                localStorage.setItem('neon_cart', JSON.stringify(cart));
                renderCart();
            });
        });
    };

    // Pre-fill user data if logged in
    const prefillUserData = async () => {
        const supabase = await window.supabaseInitPromise;
        if (supabase) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const nameInput = document.getElementById('cust-name');
                const emailInput = document.getElementById('cust-email');
                if (nameInput && !nameInput.value) {
                    nameInput.value = user.user_metadata?.full_name || '';
                }
                if (emailInput && !emailInput.value) {
                    emailInput.value = user.email || '';
                    emailInput.readOnly = true; // Lock email field to prevent tampering
                    emailInput.style.opacity = '0.7';
                }
            }
        }
    };
    prefillUserData();

    // Address input listener with 400ms debounce
    const addressInput = document.getElementById('cust-address');
    if (addressInput) {
        let debounceTimer = null;
        const onAddressInput = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const zip = getZipCode();
                if (zip !== lastZipCode) {
                    lastZipCode = zip;
                    fetchShippingRates();
                }
            }, 400);
        };

        addressInput.addEventListener('input', onAddressInput);
        addressInput.addEventListener('blur', () => {
            const zip = getZipCode();
            if (zip !== lastZipCode) {
                lastZipCode = zip;
                fetchShippingRates();
            }
        });
    }

    // Freight accessory checkboxes change listeners
    // Note: Since these elements are inside the static HTML but might not be visible, 
    // we should attach event listeners to them once at the beginning.
    const resCheckbox = document.getElementById('freight-residential');
    const liftgateCheckbox = document.getElementById('freight-liftgate');
    if (resCheckbox) {
        resCheckbox.addEventListener('change', () => {
            fetchShippingRates();
        });
    }
    if (liftgateCheckbox) {
        liftgateCheckbox.addEventListener('change', () => {
            fetchShippingRates();
        });
    }

    // Checkout button listener
    if (placeOrderBtn) {
        placeOrderBtn.addEventListener('click', async () => {
            if (cart.length === 0) return;

            if (window.location.protocol === 'file:') {
                alert('⚠️ Local server connection error:\n\nYou are accessing this page directly via the file:// protocol. Checkout operations require a running local server.\n\nPlease open your browser and navigate to:\nhttp://localhost:3000/cart.html');
                return;
            }

            const name = document.getElementById('cust-name').value.trim();
            const email = document.getElementById('cust-email').value.trim();
            const address = document.getElementById('cust-address').value.trim();

            if (!name || !email || !address) {
                alert('Please fill in all customer information fields.');
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert('Please enter a valid email address (e.g., name@example.com).');
                document.getElementById('cust-email').focus();
                return;
            }

            if (!selectedShippingRate) {
                alert('Please enter a valid shipping address and select a shipping method.');
                return;
            }

            const subtotal = cart.reduce((sum, item) => sum + (item.price * (item.quantity || 1)), 0);

            try {
                placeOrderBtn.disabled = true;
                placeOrderBtn.textContent = '⏳ Redirecting to payment...';

                // Fetch Supabase token if logged in
                const supabase = await window.supabaseInitPromise;
                let token = null;
                if (supabase) {
                    const session = (await supabase.auth.getSession()).data.session;
                    if (session) {
                        token = session.access_token;
                    }
                }

                const headers = { 'Content-Type': 'application/json' };
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch('/api/create-checkout', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        customer_name: name,
                        customer_email: email,
                        shipping_address: address,
                        items: cart,
                        total_price: subtotal,
                        shipping_method_id: selectedShippingRate.id,
                        residential: document.getElementById('freight-residential')?.checked !== false,
                        liftgate: document.getElementById('freight-liftgate')?.checked || false
                    })
                });

                const result = await response.json();

                if (result.url) {
                    // Clear cart and redirect to Stripe hosted checkout
                    localStorage.removeItem('neon_cart');
                    window.location.href = result.url;
                } else {
                    alert('Payment setup failed: ' + (result.error || 'Unknown error'));
                    placeOrderBtn.disabled = false;
                    placeOrderBtn.textContent = 'Complete Purchase';
                }
            } catch (err) {
                console.error('Checkout error:', err);
                alert('Something went wrong. Please try again.');
                placeOrderBtn.disabled = false;
                placeOrderBtn.textContent = 'Complete Purchase';
            }
        });
    }

    renderCart();
});
