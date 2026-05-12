// ── AUTH MODULE ──
const BASE_URL = 'https://n8n.srv1090894.hstgr.cloud/webhook';

export const Auth = {
    getToken()    { return localStorage.getItem('vp_token') || ''; },
    getUser()     { try { return JSON.parse(localStorage.getItem('vp_user') || '{}'); } catch { return {}; } },
    getTenantId() { return localStorage.getItem('vp_tenant_id') || ''; },
    getVenueName(){ return localStorage.getItem('vp_venue_name') || 'VenueDesk'; },
    isLoggedIn()  { return !!this.getToken(); },

    headers() {
        const tid = this.getTenantId();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getToken()}`,
            'X-Tenant-ID': tid,
            'X-Venue-ID': tid,
        };
    },

    logout() {
        localStorage.removeItem('vp_token');
        localStorage.removeItem('vp_user');
        localStorage.removeItem('vp_tenant_id');
        localStorage.removeItem('vp_venue_id');
        localStorage.removeItem('vp_venue_name');
        window.location.href = 'login.html';
    },

    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }
};

export const API_BASE = BASE_URL;
