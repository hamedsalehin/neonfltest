// ─── NANO SIGN SHARED AUTHENTICATION & CONFIGURATION ──────────────────────────

// Initialize Supabase Client dynamically from server config
async function initSupabase() {
    try {
        if (window.location.protocol === 'file:') {
            throw new Error('You are running the site directly via the file:// protocol. Please open your browser and navigate to http://localhost:3000/ to enable database and authentication features.');
        }
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('Failed to fetch config');
        const config = await res.json();
        
        if (config.supabaseUrl && config.supabaseKey) {
            if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                throw new Error('Supabase library (supabase-js) failed to load from the CDN. Please check your internet connection or ad-blocker.');
            }
            const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
            window.supabase = client;
            console.log('✅ Supabase Client initialized successfully');
            return client;
        } else {
            console.warn('⚠️ Supabase config incomplete or missing on server.');
            return null;
        }
    } catch (err) {
        console.error('❌ Error initializing Supabase client:', err);
        window.supabaseInitError = err.message || err;
        return null;
    }
}

// Global Promise for other scripts (like script.js) to await initialization
window.supabaseInitPromise = initSupabase().then((client) => {
    if (client) {
        setupAuthListener();
    }
    return client;
});

// Setup authentication state change listener
function setupAuthListener() {
    window.supabase.auth.onAuthStateChange(async (event, session) => {
        const user = session ? session.user : null;
        updateHeaderAuthUI(user);
        
        // Dispatch custom event for customizer or cart pages to listen to
        const authEvent = new CustomEvent('auth-state-changed', { detail: { user, session } });
        document.dispatchEvent(authEvent);
        
        if (user) {
            console.log('👤 Active User Session:', user.email);
            // Handle save of cached design if redirecting back from login
            handlePendingSave(user);
        }
    });
}

// Dynamic Navigation Header update
function updateHeaderAuthUI(user) {
    const authNavItem = document.getElementById('auth-nav-item');
    if (!authNavItem) return; // If nav-item element not present on this page
    
    if (user) {
        const fullName = user.user_metadata?.full_name || 'Member';
        const initials = fullName
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
            
        authNavItem.innerHTML = `
            <div class="user-nav-profile" style="position: relative; display: inline-block; line-height: 1;">
                <button class="user-avatar-badge" title="${fullName}" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: linear-gradient(135deg, var(--neon-pink, #ff007f), var(--neon-cyan, #00c6fb)); color: white; font-weight: 700; border-radius: 50%; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.4); text-shadow: 0 1px 2px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s ease; padding: 0; outline: none; box-sizing: border-box; line-height: 1;">${initials}</button>
                <div id="auth-dropdown" style="display: none; position: absolute; top: 38px; right: 0; background: rgba(15, 15, 18, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 8px 16px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5); z-index: 1000; min-width: 100px; text-align: center;">
                    <a href="#" id="auth-logout-btn" style="color: #ef4444; font-size: 0.85rem; font-weight: 600; text-decoration: none; display: block; padding: 4px 0; transition: color 0.2s ease; white-space: nowrap;">Sign Out</a>
                </div>
            </div>
        `;
        
        const avatarBadge = authNavItem.querySelector('.user-avatar-badge');
        const authDropdown = document.getElementById('auth-dropdown');
        const logoutBtn = document.getElementById('auth-logout-btn');
        
        if (avatarBadge && authDropdown) {
            avatarBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = authDropdown.style.display === 'block';
                authDropdown.style.display = isVisible ? 'none' : 'block';
            });
            
            // Hover effect on the avatar badge for tactile feedback
            avatarBadge.addEventListener('mouseenter', () => {
                avatarBadge.style.transform = 'scale(1.05)';
            });
            avatarBadge.addEventListener('mouseleave', () => {
                avatarBadge.style.transform = 'scale(1)';
            });
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const { error } = await window.supabase.auth.signOut();
                if (!error) {
                    window.location.reload();
                } else {
                    console.error('Logout error:', error.message);
                }
            });
            
            logoutBtn.addEventListener('mouseenter', () => {
                logoutBtn.style.color = '#ff6b6b';
            });
            logoutBtn.addEventListener('mouseleave', () => {
                logoutBtn.style.color = '#ef4444';
            });
        }
        
        // Close dropdown when clicking outside (using capture phase to bypass stopPropagation)
        const closeDropdown = (e) => {
            if (authDropdown && !authNavItem.contains(e.target)) {
                authDropdown.style.display = 'none';
            }
        };
        document.removeEventListener('click', window._closeAuthDropdown, { capture: true });
        window._closeAuthDropdown = closeDropdown;
        document.addEventListener('click', window._closeAuthDropdown, { capture: true });
        
    } else {
        // Logged out state
        authNavItem.innerHTML = `
            <a href="login.html" class="auth-login-link" style="text-decoration: none; color: var(--text-secondary); font-weight: 600; font-size: 0.95rem; transition: var(--transition); border: 1px solid rgba(0,0,0,0.15); padding: 8px 16px; border-radius: 100px; background: rgba(255,255,255,0.5);">Sign In</a>
        `;
    }
}

// Auto-saves design stored in sessionStorage if user just logged in
async function handlePendingSave(user) {
    const pendingSave = sessionStorage.getItem('pending_save_design');
    if (!pendingSave) return;
    
    try {
        const designData = JSON.parse(pendingSave);
        sessionStorage.removeItem('pending_save_design'); // clear immediately to prevent loops
        
        const { error } = await window.supabase
            .from('saved_designs')
            .insert({
                user_id: user.id,
                name: `${designData.text} Sign`,
                design_data: designData
            });
            
        if (!error) {
            console.log('✅ Pending design saved to database successfully!');
            // Show a visual confirmation/toast if element exists
            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#060608; color:#fff; padding:16px 24px; border-radius:12px; border:1px solid #00c6fb; z-index:9999; font-weight:600; font-size:0.9rem; box-shadow:0 10px 30px rgba(0,0,0,0.25); animation: fadeSlideUp 0.3s ease-out;';
            toast.textContent = '✨ Saved sign added to your account!';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } else {
            console.error('Error saving pending design:', error.message);
        }
    } catch (e) {
        console.error('Error parsing pending save design data:', e);
    }
}
