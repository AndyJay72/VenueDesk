// ── ROUTER MODULE ──
import { Auth } from './auth.js';
import { UI } from './ui.js';

const routes = {
    '#/':                 () => import('./pages/dashboard.js'),
    '#/bookings':         () => import('./pages/bookings.js'),
    '#/calendar':         () => import('./pages/calendar.js'),
    '#/customers':        () => import('./pages/customers.js'),
    '#/manual-booking':   () => import('./pages/manual-booking.js'),
    '#/venuepro-booking': () => import('./pages/venuepro-booking.js'),
    '#/final-payment':    () => import('./pages/final-payment.js'),
    '#/accounts':         () => import('./pages/accounts.js'),
    '#/audit-log':        () => import('./pages/audit-log.js'),
    '#/users':            () => import('./pages/users.js'),
    '#/admin-config':     () => import('./pages/admin-config.js'),
    '#/leadgen':          () => import('./pages/leadgen.js'),
    '#/onboarding':       () => import('./pages/onboarding.js'),
    '#/venuedesk':        () => import('./pages/venuedesk.js'),
    '#/enquiry':          () => import('./pages/enquiry-form.js'),
};

let currentPage = null;

export async function navigate(hash) {
    if (!Auth.requireAuth()) return;

    const route = hash || window.location.hash || '#/';
    if (window.location.hash !== route) {
        window.history.pushState(null, '', route);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
    }

    // Destroy current page
    if (currentPage?.destroy) currentPage.destroy();
    currentPage = null;

    // Clear page-specific styles
    const styleEl = document.getElementById('page-style');
    if (styleEl) styleEl.textContent = '';

    // Show spinner
    const content = document.getElementById('page-content');
    if (content) content.innerHTML = UI.spinner();

    // Load page module
    const loader = routes[route] || routes['#/'];
    try {
        const mod = await loader();
        currentPage = mod.default;

        // Inject page CSS
        if (currentPage.css && styleEl) styleEl.textContent = currentPage.css;

        // Render
        if (content && currentPage.render) content.innerHTML = currentPage.render();

        // Update title
        const titleEl = document.getElementById('page-title');
        if (titleEl) titleEl.textContent = currentPage.title || 'VenueDesk';
        document.title = `${currentPage.title || 'VenueDesk'} | VenueDesk`;

        // Update active nav
        UI.setActiveNav(route);

        // Init
        if (currentPage.init) await currentPage.init();

    } catch (err) {
        console.error('Router error:', err);
        if (content) content.innerHTML = `<div class="loading"><i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i><p>Failed to load page. <a href="#/" style="color:var(--primary)">Go home</a></p></div>`;
    }
}

export function initRouter() {
    window.navigate = navigate;
    window.addEventListener('hashchange', () => navigate(window.location.hash));
    navigate(window.location.hash || '#/');
}
