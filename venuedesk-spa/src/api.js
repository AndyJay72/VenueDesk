/**
 * api.js — centralised fetch wrapper for venuedesk-api
 *
 * Implements CLAUDE.md Pattern 4 (JWT body-tunnel) automatically:
 *   GET  requests → tenant_id injected as ?tenant_id= query param (no auth header)
 *   POST requests → { jwt, ...body } merged into request body (no auth header)
 *
 * This avoids CORS preflight failures caused by the Authorization header.
 * The server's authenticate() middleware accepts both header and body jwt.
 *
 * Pattern 3 (type safety): callers must pass UUIDs as strings and amounts
 * as numbers. This layer does not coerce — it trusts the caller.
 */

import { auth } from './auth.js';

// Production API base — proxied to /api in local dev via vite.config.js
const BASE = import.meta.env.DEV
  ? '/api'
  : 'https://api.venuedesk.co.uk';

// N8n webhook base — used for legacy automation triggers
export const N8N_BASE = 'https://n8n.srv1090894.hstgr.cloud/webhook';

// ── Response handler ─────────────────────────────────────────────────────────
async function handleResponse(res) {
  if (res.status === 401) {
    // Session expired — clear and redirect to login
    auth.clearSession();
    window.location.hash = '#/login';
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  let json;
  try { json = await res.json(); } catch { json = {}; }

  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, json?.code);
  }

  return json;
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code   = code;
  }
}

// ── Core fetch ───────────────────────────────────────────────────────────────
/**
 * @param {string}  path          — e.g. '/bookings/list'
 * @param {object}  [opts]
 * @param {string}  [opts.method] — default 'GET'
 * @param {object}  [opts.body]   — POST body (jwt is injected automatically)
 * @param {object}  [opts.params] — extra query params for GET requests
 * @param {boolean} [opts.noAuth] — skip auth injection (e.g. public endpoints)
 */
export async function apiFetch(path, { method = 'GET', body, params, noAuth = false } = {}) {
  const url = new URL(BASE + path);

  if (method === 'GET') {
    // GETs: tenant context via query param only — no JWT header to avoid preflight
    if (!noAuth) {
      const tid = auth.getTenantId();
      if (tid) url.searchParams.set('tenant_id', String(tid));
    }
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      });
    }
    return handleResponse(
      await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  // POST / PUT / PATCH / DELETE — JWT travels in body (Pattern 4)
  const payload = noAuth
    ? (body || {})
    : { jwt: auth.getToken(), ...(body || {}) };

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  return handleResponse(
    await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  );
}

// ── Convenience shorthands ───────────────────────────────────────────────────
export const api = {
  get:    (path, params)  => apiFetch(path, { method: 'GET',  params }),
  post:   (path, body)    => apiFetch(path, { method: 'POST', body }),
  put:    (path, body)    => apiFetch(path, { method: 'PUT',  body }),
  patch:  (path, body)    => apiFetch(path, { method: 'PATCH', body }),
  delete: (path, body)    => apiFetch(path, { method: 'DELETE', body }),

  // No-auth POST — used for login
  postPublic: (path, body) => apiFetch(path, { method: 'POST', body, noAuth: true }),
};

// ── N8n webhook helper ───────────────────────────────────────────────────────
// Legacy n8n calls still pass jwt in body — same tunnel pattern
export async function n8nPost(path, body = {}) {
  const res = await fetch(N8N_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwt: auth.getToken(), ...body }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, json?.message || `N8n error ${res.status}`);
  }
  return res.json();
}
