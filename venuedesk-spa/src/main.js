/**
 * main.js — SPA bootstrap
 *
 * Order:
 *   1. Import global styles
 *   2. Init auth (populate store from sessionStorage)
 *   3. Init router (renders first view, listens for hash changes)
 *   4. Start session expiry monitor (silent logout on token expiry)
 */

import './styles/main.css';
import './styles/legacy-global.css'; // highest priority — verbatim from static source files
import { auth } from './auth.js';
import { store } from './store.js';
import { initRouter } from './router.js';

// ── Populate store from existing session ─────────────────────────────────────
if (auth.isAuthenticated()) {
  const user = auth.getUser();
  store.user     = user;
  store.tenantId = auth.getTenantId();
}

// ── Session expiry monitor ────────────────────────────────────────────────────
// Checks every 60s. If < 5 min remain, shows a warning toast once.
// On expiry, clears session and redirects to login.
let _warnedExpiry = false;

setInterval(() => {
  if (!auth.isAuthenticated()) return;

  const remaining = auth.expiresIn();

  if (remaining <= 0) {
    auth.logout();
    return;
  }

  if (remaining < 300 && !_warnedExpiry) {
    _warnedExpiry = true;
    // Lazy-import toast to avoid circular deps at boot
    import('./components/toast.js').then(({ toast }) => {
      toast.warning('Your session expires in less than 5 minutes. Save your work.');
    });
  }
}, 60_000);

// ── Boot router ───────────────────────────────────────────────────────────────
initRouter();
