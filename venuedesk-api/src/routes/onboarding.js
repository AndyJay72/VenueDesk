'use strict';

/**
 * /onboarding routes — VenueDesk Ltd super-admin API.
 * Used by the VenueDesk back-office to provision and manage venue tenants.
 *
 * Auth: X-Admin-Key header (checked against ONBOARDING_ADMIN_KEY env var).
 *       These routes are cross-tenant — they bypass withTenantContext and
 *       use the raw pool directly since RLS tenant isolation does not apply
 *       to super-admin operations.
 *
 * POST /onboarding/login            — validate admin key (returns { ok: true })
 * GET  /onboarding/venues           — list all tenants + their admin users
 * POST /onboarding/create-venue     — provision tenant + admin staff user atomically
 * POST /onboarding/reset-password   — reset any staff user password by username
 * POST /onboarding/toggle-venue     — toggle tenant active flag
 * POST /onboarding/update-venue     — update tenant name/slug + user full_name
 *
 * Future: billing, subscription management (Phase 3 expansion).
 *
 * NOTE: DB: Mark Lead Converted (leads DB, credential "Postgres account 3")
 * is intentionally stubbed. It targets a separate leadgen database not connected
 * to this pool. Wire it up when the leadgen db-api integration is built.
 */

const crypto = require('crypto');
const { pool } = require('../db/pool');

const ADMIN_KEY = process.env.ONBOARDING_ADMIN_KEY || 'vp-onboarding-admin-change-me';
const PEPPER    = process.env.PASSWORD_PEPPER       || 'vp-pepper-change-me-in-env';

function hashPassword(password) {
  return crypto.createHash('sha512').update(PEPPER + password).digest('hex');
}

// ── Prehandler: validate X-Admin-Key on every route ──────────────────────────
async function requireAdminKey(request, reply) {
  const key = request.headers['x-admin-key'] || request.body?.admin_key || '';
  if (key !== ADMIN_KEY) {
    reply.code(401).send({ success: false, code: 'INVALID_ADMIN_KEY', message: 'Invalid admin key' });
  }
}

async function onboardingRoutes(fastify) {

  // ─── POST /onboarding/login ───────────────────────────────────────────────
  // Validates admin key. Frontend calls this first to confirm credentials.
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['admin_key'],
        properties: { admin_key: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    await requireAdminKey(request, reply);
    return { ok: true };
  });


  // ─── GET /onboarding/venues ───────────────────────────────────────────────
  // Lists all tenants joined with their staff users.
  // Replaces: DB: Init Columns (DDL — handled by migrations) + DB: List Venues.
  fastify.get('/venues', {
    preHandler: [requireAdminKey],
  }, async () => {
    const { rows } = await pool.query(
      `SELECT t.tenant_id,
              t.venue_id,
              t.name        AS venue_name,
              t.slug,
              t.active,
              t.created_at::date AS created_date,
              u.username,
              u.full_name,
              u.is_active   AS user_active,
              u.id::text    AS user_id
       FROM   bookings.tenants t
       LEFT JOIN bookings.staff_users u ON u.tenant_id = t.tenant_id
       ORDER BY t.tenant_id`
    );
    return { success: true, data: rows };
  });


  // ─── POST /onboarding/create-venue ───────────────────────────────────────
  // Provisions a new tenant row and its first admin staff user atomically.
  // Password hashing is done here (PEPPER + SHA512) — matches auth.js.
  //
  // Body: { tenant_id, venue_name, username, password, full_name?, slug?, prospect_id? }
  fastify.post('/create-venue', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'venue_name', 'username', 'password'],
        properties: {
          tenant_id:   { type: 'integer', minimum: 1000 },
          venue_name:  { type: 'string', minLength: 1 },
          username:    { type: 'string', minLength: 1 },
          password:    { type: 'string', minLength: 6 },
          full_name:   { type: 'string' },
          slug:        { type: 'string' },
          prospect_id: { type: 'string' },
          admin_key:   { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const {
      tenant_id,
      venue_name,
      username,
      password,
      full_name   = venue_name,
      prospect_id = null,
    } = request.body;

    const slug           = (request.body.slug || venue_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).trim();
    const normUsername   = username.trim().toLowerCase();
    const hashedPassword = hashPassword(password);

    const { rows } = await pool.query(
      `WITH ins_tenant AS (
         INSERT INTO bookings.tenants (tenant_id, venue_id, name, slug, active)
         VALUES ($1, $1, $2, $3, TRUE)
         ON CONFLICT (tenant_id) DO UPDATE
           SET name = EXCLUDED.name, slug = EXCLUDED.slug
         RETURNING tenant_id, name
       )
       INSERT INTO bookings.staff_users
         (username, hashed_password, role, full_name, is_active, tenant_id)
       VALUES ($4, $5, 'admin', $6, TRUE, (SELECT tenant_id FROM ins_tenant))
       ON CONFLICT (username) DO UPDATE
         SET hashed_password = EXCLUDED.hashed_password,
             full_name       = EXCLUDED.full_name,
             tenant_id       = EXCLUDED.tenant_id
       RETURNING id::text, username, role, full_name, tenant_id`,
      [tenant_id, venue_name.trim(), slug, normUsername, hashedPassword, full_name.trim()]
    );

    return {
      ok:          true,
      data:        rows,
      prospect_id: prospect_id || null,   // returned so caller can fire lead-converted if needed
    };
  });


  // ─── POST /onboarding/reset-password ─────────────────────────────────────
  // Resets a staff user's password by username (cross-tenant).
  // Password hashing: PEPPER + SHA512 — matches auth.js.
  //
  // Body: { username, password }
  fastify.post('/reset-password', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username:  { type: 'string', minLength: 1 },
          password:  { type: 'string', minLength: 6 },
          admin_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { username, password } = request.body;
    const normUsername   = username.trim().toLowerCase();
    const hashedPassword = hashPassword(password);

    const { rows, rowCount } = await pool.query(
      `UPDATE bookings.staff_users
       SET    hashed_password = $2
       WHERE  username = $1
       RETURNING id::text, username`,
      [normUsername, hashedPassword]
    );

    if (rowCount === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `User '${normUsername}' not found` };
    }
    return { ok: true, data: rows[0] };
  });


  // ─── POST /onboarding/toggle-venue ───────────────────────────────────────
  // Flips the active flag on a tenant row.
  //
  // Body: { tenant_id }
  fastify.post('/toggle-venue', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id'],
        properties: {
          tenant_id: { type: 'integer' },
          admin_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenant_id } = request.body;

    const { rows, rowCount } = await pool.query(
      `UPDATE bookings.tenants
       SET    active = NOT active
       WHERE  tenant_id = $1
       RETURNING tenant_id, name, active`,
      [tenant_id]
    );

    if (rowCount === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `Tenant ${tenant_id} not found` };
    }
    return { ok: true, data: rows[0] };
  });


  // ─── POST /onboarding/update-venue ───────────────────────────────────────
  // Updates tenant name/slug and staff user full_name in a single transaction.
  // Blank strings leave existing values intact (CASE WHEN pattern).
  //
  // Body: { tenant_id, venue_name?, slug?, full_name? }
  fastify.post('/update-venue', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id'],
        properties: {
          tenant_id:  { type: 'integer' },
          venue_name: { type: 'string' },
          slug:       { type: 'string' },
          full_name:  { type: 'string' },
          admin_key:  { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const {
      tenant_id,
      venue_name = '',
      slug       = '',
      full_name  = '',
    } = request.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE bookings.tenants
         SET name = CASE WHEN $1 <> '' THEN $1 ELSE name END,
             slug = CASE WHEN $2 <> '' THEN $2 ELSE slug END
         WHERE tenant_id = $3`,
        [venue_name, slug, tenant_id]
      );

      if (full_name) {
        await client.query(
          `UPDATE bookings.staff_users
           SET full_name = $1
           WHERE tenant_id = $2`,
          [full_name, tenant_id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { ok: true };
  });

}

module.exports = onboardingRoutes;
