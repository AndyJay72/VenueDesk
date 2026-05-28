'use strict';

/**
 * /users routes — Phase 2 SQL Node Purge.
 * Replaces: oxBp6cEoB3ZBRwB2.json (VenuePro - User Manager) Postgres nodes.
 *
 * All tenant_id values come exclusively from the verified JWT payload.
 * Password hashing uses PEPPER + SHA512 (matches auth.js and existing hashes).
 *
 * GET  /users/list    — list staff_users for tenant
 * POST /users/create  — create staff user (hash password server-side)
 * POST /users/delete  — delete staff user by id
 */

const crypto            = require('crypto');
const { withTenantContext } = require('../db/pool');
const logger            = require('../services/LoggerService');
const { notFound, conflict, forbidden, badRequest } = require('../utils/errors');
const { assertUUID, assertRequired } = require('../utils/validators');

// Must match auth.js — pepper is baked into all existing password hashes.
const PEPPER = process.env.PASSWORD_PEPPER || 'vp-pepper-change-me-in-env';

async function usersRoutes(fastify) {

  // ─── GET /users/list ───────────────────────────────────────────────────────
  // Returns all staff users for the authenticated tenant.
  // Mirrors oxBp6cEoB3ZBRwB2 → DB: List Users.
  fastify.get('/list', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT id, username, full_name, role, created_at, is_active
         FROM   bookings.staff_users
         WHERE  tenant_id = $1::integer
         ORDER  BY created_at DESC`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });

  // ─── POST /users/create ────────────────────────────────────────────────────
  // Creates a new staff user. Password is hashed server-side using the same
  // PEPPER + SHA512 approach as auth.js / the original n8n workflow.
  // Mirrors oxBp6cEoB3ZBRwB2 → DB: Insert User (SQL).
  //
  // Admin role required — users cannot create peer accounts.
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'full_name', 'role', 'password'],
        properties: {
          username:  { type: 'string', minLength: 2 },
          full_name: { type: 'string', minLength: 1 },
          role:      { type: 'string', enum: ['admin', 'staff', 'manager'] },
          password:  { type: 'string', minLength: 6 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    if (request.user.role !== 'admin') {
      throw forbidden('Admin role required to create users');
    }

    const { username, full_name, role, password } = request.body;

    const normalisedUsername = username.trim().toLowerCase();
    const hashedPassword = crypto
      .createHash('sha512')
      .update(PEPPER + password)
      .digest('hex');

    return withTenantContext(tenantId, async (client) => {
      let rows;
      try {
        ({ rows } = await client.query(
          `INSERT INTO bookings.staff_users
             (username, full_name, role, hashed_password, is_active, tenant_id)
           VALUES ($1, $2, $3, $4, TRUE, $5)
           RETURNING id, username, full_name, role, created_at, is_active`,
          [normalisedUsername, full_name.trim(), role, hashedPassword, tenantId]
        ));
      } catch (err) {
        if (err.code === '23505') {
          throw conflict('User', `username '${normalisedUsername}' already exists`);
        }
        throw err;
      }

      await logger.info(
        'UsersRoute',
        `Staff user created: ${normalisedUsername}`,
        { username: normalisedUsername, role, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /users/delete ────────────────────────────────────────────────────
  // Hard-deletes a staff user. Admin only. Cannot delete own account.
  // Mirrors oxBp6cEoB3ZBRwB2 → DB: Delete User.
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { user_id } = request.body;

    if (request.user.role !== 'admin') {
      throw forbidden('Admin role required to delete users');
    }

    assertUUID(user_id, 'user_id');

    // Prevent self-deletion
    if (user_id === request.user.user_id) {
      throw badRequest('Cannot delete your own account');
    }

    return withTenantContext(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM bookings.staff_users
         WHERE id = $1::uuid AND tenant_id = $2::integer`,
        [user_id, tenantId]
      );

      if (rowCount === 0) throw notFound('User', user_id);

      await logger.info(
        'UsersRoute',
        `Staff user deleted: ${user_id}`,
        { user_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: { user_id, deleted: true } };
    });
  });
}

module.exports = usersRoutes;
