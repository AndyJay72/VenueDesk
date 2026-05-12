'use strict';

/**
 * users-update.js — Staff user management write operations
 *
 * Registered at /users in server.js alongside the existing usersRoutes.
 * Fastify supports multiple plugins at the same prefix — routes are additive.
 *
 * Routes:
 *   POST /users/update — authenticated; update full_name, role, and optionally
 *                        reset password for a staff user in the same tenant.
 *
 * Security:
 *   - JWT body-tunnel (Pattern 4) — jwt in request body
 *   - tenant_id from JWT only — never trusted from body
 *   - Password hashing: SHA512(PEPPER + password) matching auth.js and n8n
 *   - Users can only update staff_users WHERE tenant_id = JWT tenant_id
 */

const crypto             = require('crypto');
const { withTenantContext } = require('../db/pool');

const PEPPER = process.env.PASSWORD_PEPPER || 'vp-pepper-change-me';

module.exports = async function usersUpdateRoutes(fastify, _opts) {

  // ── POST /users/update ────────────────────────────────────────────────────
  fastify.post('/update', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId = req.user.tenant_id;

    const { user_id, full_name, role, password } = req.body || {};

    if (!user_id) {
      return reply.code(400).send({ success: false, message: 'user_id required' });
    }
    if (!full_name || !full_name.trim()) {
      return reply.code(400).send({ success: false, message: 'full_name required' });
    }

    const validRoles = ['admin', 'manager', 'staff'];
    if (role && !validRoles.includes(role)) {
      return reply.code(400).send({ success: false, message: 'role must be admin, manager, or staff' });
    }

    const result = await withTenantContext(tenantId, async (client) => {
      // Verify the user exists and belongs to this tenant
      const { rows: existing } = await client.query(
        `SELECT id, username FROM bookings.staff_users
         WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
        [user_id, tenantId]
      );
      if (existing.length === 0) {
        return null; // not found or wrong tenant
      }

      if (password && password.trim().length > 0) {
        // Password reset — hash with same SHA512 + pepper as auth.js
        if (password.trim().length < 6) {
          throw Object.assign(new Error('Password must be at least 6 characters'), { statusCode: 400 });
        }
        const hashed = crypto
          .createHash('sha512')
          .update(PEPPER + password.trim())
          .digest('hex');

        const { rows } = await client.query(
          `UPDATE bookings.staff_users
           SET full_name       = $1,
               role            = COALESCE(NULLIF($2, ''), role),
               hashed_password = $3,
               updated_at      = NOW()
           WHERE id = $4 AND tenant_id = $5
           RETURNING id, username, full_name, role, tenant_id`,
          [full_name.trim(), role || '', hashed, user_id, tenantId]
        );
        return rows[0] || null;
      } else {
        // Name / role update only — leave password unchanged
        const { rows } = await client.query(
          `UPDATE bookings.staff_users
           SET full_name  = $1,
               role       = COALESCE(NULLIF($2, ''), role),
               updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4
           RETURNING id, username, full_name, role, tenant_id`,
          [full_name.trim(), role || '', user_id, tenantId]
        );
        return rows[0] || null;
      }
    });

    if (!result) {
      return reply.code(404).send({ success: false, message: 'User not found' });
    }

    return reply.send({ success: true, user: result });
  });
};
