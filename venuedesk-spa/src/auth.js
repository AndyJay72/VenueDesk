/**
 * auth.js — JWT lifecycle management
 *
 * Storage: sessionStorage (CLAUDE.md Pattern 6)
 * Keys match the existing CommunityHub contract exactly so any
 * shared session between old pages and the SPA is transparent:
 *   vp_token      — raw JWT string
 *   vp_tenant_id  — integer tenant id
 *   vp_user_name  — display name
 *   vp_venue_name — venue display name
 *   vp_user       — full user JSON blob
 */

const KEYS = {
  token:    'vp_token',
  tenantId: 'vp_tenant_id',
  userName: 'vp_user_name',
  venueName:'vp_venue_name',
  user:     'vp_user',
};

// ── Decode JWT payload without verifying (verification is server-side) ──────
function decodePayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const auth = {
  /** Store session after a successful login response */
  setSession(data) {
    const token = data.token;
    const user  = data.user || {};

    sessionStorage.setItem(KEYS.token,    token);
    sessionStorage.setItem(KEYS.tenantId, String(user.tenant_id ?? ''));
    sessionStorage.setItem(KEYS.userName, user.full_name || user.name || user.username || '');
    sessionStorage.setItem(KEYS.venueName,user.full_name || user.name || '');
    sessionStorage.setItem(KEYS.user,     JSON.stringify(user));
  },

  getToken()    { return sessionStorage.getItem(KEYS.token)    || ''; },
  getTenantId() { return parseInt(sessionStorage.getItem(KEYS.tenantId) || '0', 10) || null; },
  getUserName() { return sessionStorage.getItem(KEYS.userName) || ''; },
  getUser()     { try { return JSON.parse(sessionStorage.getItem(KEYS.user) || '{}'); } catch { return {}; } },

  getRole() {
    const payload = decodePayload(this.getToken());
    return payload?.role || '';
  },

  isAdmin() { return this.getRole() === 'admin'; },

  /** Returns true if a non-expired token exists in sessionStorage */
  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;
    const payload = decodePayload(token);
    if (!payload) return false;
    // exp is Unix seconds — multiply by 1000 to compare against Date.now() (ms)
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      const overdue = Math.floor(Date.now() / 1000) - payload.exp;
      console.warn(
        `[auth] Token expired ${overdue}s ago. ` +
        `Current time: ${new Date().toISOString()}, ` +
        `Expiry time: ${new Date(payload.exp * 1000).toISOString()}. ` +
        `Clearing session.`
      );
      this.clearSession();
      return false;
    }
    if (payload.exp) {
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      console.log(
        `[auth] Token valid — expires in ${remaining}s ` +
        `(${Math.floor(remaining / 60)}m ${remaining % 60}s). ` +
        `Expiry: ${new Date(payload.exp * 1000).toISOString()}`
      );
    }
    return true;
  },

  /** Returns seconds until expiry, or 0 if expired/absent */
  expiresIn() {
    const payload = decodePayload(this.getToken());
    if (!payload?.exp) return 0;
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  },

  clearSession() {
    Object.values(KEYS).forEach(k => sessionStorage.removeItem(k));
  },

  logout() {
    this.clearSession();
    // Router will redirect to /login on next navigation
    window.location.hash = '#/login';
  },
};
