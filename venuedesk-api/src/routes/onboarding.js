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
const PEPPER    = process.env.PASSWORD_PEPPER       || 'vp-pepper-change-me';

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
      `SELECT DISTINCT ON (t.tenant_id)
              t.tenant_id,
              t.venue_id,
              t.name        AS venue_name,
              t.slug,
              t.active,
              t.created_at::date AS created_date,
              u.username,
              COALESCE(t.contact_name, u.full_name) AS full_name,
              u.is_active   AS user_active,
              u.id::text    AS user_id
       FROM   bookings.tenants t
       LEFT JOIN bookings.staff_users u ON u.tenant_id = t.tenant_id
       ORDER BY t.tenant_id, u.role = 'admin' DESC NULLS LAST, u.created_at ASC NULLS LAST`,
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


  // ─── POST /onboarding/create-staff-user ──────────────────────────────────
  // Adds a staff user to an EXISTING tenant without touching the tenant row.
  // Use this when a venue already exists but needs a login set or a new user added.
  //
  // Body: { tenant_id, username, password, full_name? }
  fastify.post('/create-staff-user', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'username', 'password'],
        properties: {
          tenant_id: { type: 'integer', minimum: 1 },
          username:  { type: 'string', minLength: 1 },
          password:  { type: 'string', minLength: 6 },
          full_name: { type: 'string' },
          admin_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenant_id, username, password, full_name = '' } = request.body;
    const normUsername   = username.trim().toLowerCase();
    const hashedPassword = hashPassword(password);

    // Verify tenant exists
    const { rowCount: tenantExists } = await pool.query(
      `SELECT 1 FROM bookings.tenants WHERE tenant_id = $1`, [tenant_id]
    );
    if (tenantExists === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `Tenant ${tenant_id} not found` };
    }

    const { rows } = await pool.query(
      `INSERT INTO bookings.staff_users
         (username, hashed_password, role, full_name, is_active, tenant_id)
       VALUES ($1, $2, 'admin', $3, TRUE, $4)
       ON CONFLICT (username) DO UPDATE
         SET hashed_password = EXCLUDED.hashed_password,
             full_name       = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE bookings.staff_users.full_name END,
             tenant_id       = EXCLUDED.tenant_id
       RETURNING id::text, username, role, full_name, tenant_id`,
      [normUsername, hashedPassword, full_name.trim(), tenant_id]
    );

    return { ok: true, data: rows[0] };
  });


  // ─── POST /onboarding/delete-staff-user ──────────────────────────────────
  // Deletes a staff user by username (cross-tenant, admin-key protected).
  // Use to remove accidental duplicate users.
  //
  // Body: { username }
  fastify.post('/delete-staff-user', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username:  { type: 'string', minLength: 1 },
          admin_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { username } = request.body;
    const normUsername = username.trim().toLowerCase();

    const { rowCount } = await pool.query(
      `DELETE FROM bookings.staff_users WHERE username = $1`, [normUsername]
    );

    if (rowCount === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `User '${normUsername}' not found` };
    }
    return { ok: true, deleted: normUsername };
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
  // Updates tenant name/slug, contact name, and optionally the admin username.
  // Blank strings leave existing values intact (CASE WHEN pattern).
  //
  // Body: { tenant_id, venue_name?, slug?, full_name?, new_username? }
  fastify.post('/update-venue', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id'],
        properties: {
          tenant_id:    { type: 'integer' },
          venue_name:   { type: 'string' },
          slug:         { type: 'string' },
          full_name:    { type: 'string' },
          new_username: { type: 'string' },
          admin_key:    { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const {
      tenant_id,
      venue_name   = '',
      slug         = '',
      full_name    = '',
      new_username = '',
    } = request.body;

    const normUsername = new_username.trim().toLowerCase();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update tenant row
      await client.query(
        `UPDATE bookings.tenants
         SET name         = CASE WHEN $1 <> '' THEN $1 ELSE name END,
             slug         = CASE WHEN $2 <> '' THEN $2 ELSE slug END,
             contact_name = CASE WHEN $3 <> '' THEN $3 ELSE contact_name END
         WHERE tenant_id = $4`,
        [venue_name, slug, full_name, tenant_id]
      );

      // Update staff user full_name and/or username
      if (full_name || normUsername) {
        await client.query(
          `UPDATE bookings.staff_users
           SET full_name = CASE WHEN $1 <> '' THEN $1 ELSE full_name END,
               username  = CASE WHEN $2 <> '' THEN $2 ELSE username  END
           WHERE tenant_id = $3`,
          [full_name, normUsername, tenant_id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Username conflict
      if (err.code === '23505') {
        return { ok: false, code: 'CONFLICT', message: `Username '${normUsername}' is already taken` };
      }
      throw err;
    } finally {
      client.release();
    }

    return { ok: true };
  });


  // ─── POST /onboarding/delete-tenant ──────────────────────────────────────
  // Permanently deletes a tenant and ALL associated data in a transaction.
  // Cascades through: staff_users, customers, interactions, booking_requests,
  // confirmed_bookings, payments, rooms, settings, recurring data, etc.
  //
  // Safety guards:
  //   • tenant_id 1 (system admin) is never deletable
  //   • requires confirm: true in body to prevent accidental deletion
  //
  // Body: { tenant_id, confirm: true }
  fastify.post('/delete-tenant', {
    preHandler: [requireAdminKey],
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'confirm'],
        properties: {
          tenant_id: { type: 'integer', minimum: 1 },
          confirm:   { type: 'boolean' },
          admin_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenant_id, confirm } = request.body;

    if (tenant_id === 1) {
      return { ok: false, code: 'FORBIDDEN', message: 'System admin tenant cannot be deleted' };
    }
    if (confirm !== true) {
      return { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Pass confirm: true to proceed' };
    }

    // Verify tenant exists first
    const { rowCount: exists } = await pool.query(
      `SELECT 1 FROM bookings.tenants WHERE tenant_id = $1`, [tenant_id]
    );
    if (exists === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `Tenant ${tenant_id} not found` };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete in dependency order to avoid FK violations
      await client.query(`DELETE FROM bookings.recurring_payment_schedule WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.recurring_series          WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.recurring_rules           WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.payments
                          WHERE booking_id IN (
                            SELECT id FROM bookings.confirmed_bookings WHERE tenant_id = $1
                          )`, [tenant_id]);
      await client.query(`DELETE FROM bookings.confirmed_bookings        WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.booking_requests          WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.customer_interactions     WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.customers                 WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.rooms                     WHERE tenant_id = $1`, [tenant_id]);
      // bookings.settings has no tenant_id (global key-value store, RLS-scoped via session)
      await client.query(`DELETE FROM bookings.add_on_services           WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.policy_templates          WHERE tenant_id = $1`, [tenant_id]);
      await client.query(`DELETE FROM bookings.staff_users               WHERE tenant_id = $1`, [tenant_id]);
      const { rows } = await client.query(
        `DELETE FROM bookings.tenants WHERE tenant_id = $1 RETURNING tenant_id, name`, [tenant_id]
      );

      await client.query('COMMIT');
      return { ok: true, deleted: { tenant_id, name: rows[0]?.name } };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

}

module.exports = onboardingRoutes;
