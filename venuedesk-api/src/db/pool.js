'use strict';

const { Pool } = require('pg');

/**
 * Two-pool architecture — Phase 4b RLS enforcement.
 *
 * systemPool  — n8n superuser (DATABASE_URL).
 *   Bypasses FORCE ROW LEVEL SECURITY by design.
 *   Used ONLY by: runMigrations (DDL), systemQuery, withServiceContext(fn)
 *   cross-tenant scheduled jobs (BillingCycleTrigger, PaymentChaser etc.)
 *
 * appPool     — venuedesk_app restricted role (APP_DATABASE_URL).
 *   Subject to FORCE ROW LEVEL SECURITY on all 12 tenant tables.
 *   Used by: withTenantContext (all user-facing routes),
 *            withServiceContext(tenantId, fn) (n8n proxy with explicit tenant)
 *
 * If APP_DATABASE_URL is not set (local dev without the restricted role),
 * appPool falls back to systemPool — RLS still functionally enabled but
 * not forced. Set APP_DATABASE_URL in docker-compose.yml for production.
 */

// ── System pool (superuser) ───────────────────────────────────────────────────
const systemPoolConfig = process.env.DATABASE_URL
  ? {
      connectionString:        process.env.DATABASE_URL,
      max:                     5,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    }
  : {
      host:     process.env.PGHOST     || 'postgres',
      port:     parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'bookings_db',
      user:     process.env.PGUSER     || 'n8n',
      password: process.env.PGPASSWORD || 'n8npassword',
      max:                     5,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    };

const pool = new Pool(systemPoolConfig);
pool.on('error', (err) => console.error('[pg:system-pool] unexpected error', err.message));

// ── Application pool (restricted role — FORCE RLS applies) ────────────────────
const appPoolConfig = process.env.APP_DATABASE_URL
  ? {
      connectionString:        process.env.APP_DATABASE_URL,
      max:                     20,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    }
  : systemPoolConfig; // fallback: local dev without venuedesk_app role

const appPool = new Pool(
  process.env.APP_DATABASE_URL ? appPoolConfig : systemPoolConfig
);
appPool.on('error', (err) => console.error('[pg:app-pool] unexpected error', err.message));

// ── withTenantContext ─────────────────────────────────────────────────────────
/**
 * Execute fn(client) inside a transaction scoped to tenantId.
 * Uses appPool — FORCE RLS enforced via set_config('app.tenant_id').
 * CLAUDE.md Pattern 2: set_config() not parameterised SET LOCAL.
 */
async function withTenantContext(tenantId, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── systemQuery ───────────────────────────────────────────────────────────────
/**
 * System-level query — no tenant context.
 * Uses systemPool (superuser) — bypasses RLS intentionally.
 * Use ONLY for migrations, DDL, and system_logs.
 */
async function systemQuery(text, params) {
  return pool.query(text, params);
}

// ── withServiceContext ────────────────────────────────────────────────────────
/**
 * Two call signatures (backward-compatible):
 *
 *   withServiceContext(fn)
 *     — No tenant context. Cross-tenant scheduled jobs (BillingCycleTrigger etc.)
 *       Uses systemPool to bypass FORCE RLS — caller must include explicit
 *       WHERE tenant_id = ... filters in SQL.
 *
 *   withServiceContext(tenantId, fn)
 *     — Sets app.tenant_id. Satisfies FORCE RLS for service-JWT n8n proxy calls.
 *       Uses appPool — RLS enforced, tenant-scoped.
 */
async function withServiceContext(tenantIdOrFn, fn) {
  const hasTenant = typeof tenantIdOrFn !== 'function';
  const tenantId  = hasTenant ? tenantIdOrFn : null;
  const callback  = hasTenant ? fn : tenantIdOrFn;

  // Cross-tenant (no tenantId) → systemPool bypasses FORCE RLS
  // Tenant-scoped (tenantId set) → appPool, RLS enforced via set_config
  const clientPool = hasTenant ? appPool : pool;

  const client = await clientPool.connect();
  try {
    await client.query('BEGIN');
    if (tenantId) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, appPool, withTenantContext, withServiceContext, systemQuery };
