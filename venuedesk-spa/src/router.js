/**
 * router.js — hash-based SPA router
 *
 * Hash routing (#/path) is required for GitHub Pages static hosting —
 * the server always serves index.html and the browser handles routing.
 *
 * Route guard: unauthenticated users are redirected to #/login.
 * Authenticated users hitting #/login are redirected to #/dashboard.
 *
 * Views export a { mount(container) } object:
 *   mount(container) — renders into the container element
 */

import { auth } from './auth.js';
import { store } from './store.js';

// Lazy imports — each view module is only loaded when first visited
const ROUTES = {
  '/login':             () => import('./views/login.js'),
  '/dashboard':         () => import('./views/dashboard.js'),
  '/calendar':          () => import('./views/calendar.js'),
  '/accounts':          () => import('./views/accounts.js'),
  '/customers':         () => import('./views/customers.js'),
  '/recurring-bookings':() => import('./views/recurring-bookings.js'),
  '/audit-log':         () => import('./views/audit-log.js'),
  '/admin-config':      () => import('./views/admin-config.js'),
  '/checkout':          () => import('./views/checkout.js'),
};

// Public routes that don't require authentication
const PUBLIC_ROUTES = new Set(['/login']);

function getRoute() {
  const hash = window.location.hash.slice(1); // strip '#'
  const path = hash.split('?')[0] || '/dashboard';
  return path.startsWith('/') ? path : '/' + path;
}

export function navigate(path, replace = false) {
  const method = replace ? 'replaceState' : 'pushState';
  // history.pushState doesn't trigger hashchange, so we set hash directly
  window.location.hash = path;
}

async function render() {
  const path      = getRoute();
  const container = document.getElementById('app');
  const isPublic  = PUBLIC_ROUTES.has(path);
  const isAuthed  = auth.isAuthenticated();

  // Auth guard
  if (!isAuthed && !isPublic) {
    window.location.hash = '#/login';
    return;
  }
  if (isAuthed && path === '/login') {
    window.location.hash = '#/dashboard';
    return;
  }

  store.currentRoute = path;

  // Show loading state while module loads
  container.innerHTML = `
    <div class="loading-state" style="width:100%;min-height:100vh;">
      <div class="spinner"></div>
    </div>
  `;

  // Look up route (handle unknown paths → dashboard)
  const loader = ROUTES[path] || ROUTES['/dashboard'];

  try {
    const module = await loader();
    const view   = module.default;
    container.innerHTML = '';
    await view.mount(container);
  } catch (err) {
    console.error('[router] failed to load view:', path, err);
    container.innerHTML = `
      <div class="loading-state" style="width:100%;min-height:100vh;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem;color:var(--danger);"></i>
        <p>Failed to load page. <a href="#/dashboard" style="color:var(--primary);">Return to dashboard</a></p>
      </div>
    `;
  }
}

export function initRouter() {
  window.addEventListener('hashchange', render);
  // Initial render on page load
  render();
}
