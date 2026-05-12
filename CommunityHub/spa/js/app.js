// ── APP ENTRY POINT ──
import { Auth } from './auth.js';
import { UI } from './ui.js';
import { initRouter } from './router.js';

// Expose globals for inline onclick handlers
window.Auth = Auth;
window.UI = UI;

// Auth guard
if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html';
} else {
    // Init UI
    UI.initTheme();
    UI.initSidebar();
    UI.startClock();

    // Boot router
    initRouter();
}
