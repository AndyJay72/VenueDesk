/**
 * store.js — lightweight reactive state
 *
 * Uses JavaScript Proxy to intercept writes and notify subscribers.
 * No external dependencies. No immutability overhead.
 *
 * Usage:
 *   import { store, subscribe } from './store.js';
 *
 *   store.user = { id: '...', role: 'admin' };  // triggers subscribers
 *
 *   const unsub = subscribe('user', (val) => console.log('user changed', val));
 *   unsub(); // cleanup
 */

const _listeners = new Map();

const _state = {
  // ── Auth / identity ──────────────────────────────────────────────────
  user:       null,   // { user_id, tenant_id, role, full_name }
  tenantId:   null,   // integer

  // ── Tenant runtime config ─────────────────────────────────────────────
  // Loaded once on login — drives Stripe vs BACS fork everywhere
  paymentConfig: null, // { is_stripe_enabled, stripe_publishable_key, bacs_* }

  // ── Shared data caches (invalidated on route change where relevant) ───
  rooms:      [],
  bookings:   [],
  customers:  [],

  // ── UI state ──────────────────────────────────────────────────────────
  sidebarCollapsed: false,
  currentRoute:     '',
};

function notify(key, value) {
  (_listeners.get(key) || []).forEach(fn => {
    try { fn(value); } catch (e) { console.error('[store] subscriber error', key, e); }
  });
}

export const store = new Proxy(_state, {
  set(target, key, value) {
    target[key] = value;
    notify(key, value);
    return true;
  },
  get(target, key) {
    return target[key];
  },
});

/**
 * Subscribe to a specific store key.
 * @returns {Function} unsubscribe function
 */
export function subscribe(key, fn) {
  if (!_listeners.has(key)) _listeners.set(key, []);
  _listeners.get(key).push(fn);
  return () => {
    const arr = _listeners.get(key) || [];
    _listeners.set(key, arr.filter(f => f !== fn));
  };
}

/**
 * Reset all store state (called on logout)
 */
export function resetStore() {
  Object.keys(_state).forEach(k => {
    if (Array.isArray(_state[k]))      store[k] = [];
    else if (typeof _state[k] === 'boolean') store[k] = false;
    else store[k] = null;
  });
}
