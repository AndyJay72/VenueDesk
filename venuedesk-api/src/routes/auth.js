'use strict';

/**
 * /auth routes — login with JWT signing.
 *
 * POST /auth/login — verify staff credentials, sign JWT, return token + user.
 *
 * Previously auth.js returned only the raw user row ({success, data}) for n8n
 * to sign the JWT. That left JWT signing in n8n and caused the tenant_id to be
 * missing or wrong when the n8n workflow had stale/broken JWT claims.
 *
 * Now auth.js signs the JWT directly (fastify.jwt.sign) — n8n is no longer in
 * the auth path. Response shape matches what login.html expects:
 *   { token: "...", user: { id, username, role, full_name, tenant_id } }
 *
 * CLAUDE.md Pattern 1 — JWT payload:
 *   { id, username, role, full_name, tenant_id }
 *   (id AND user_id both set so auth middleware normalisation always finds user_id)
 *
 * Security notes:
 *   - No authenticate middleware: no JWT exists at call time.
 *   - PEPPER must match the constant baked into existing DB hashes.
 *   - Uses pool directly (no withTenantContext) — login spans all tenants.
 *   - Generic 401 on any failure — no enumeration hints.
 */

const crypto   = require('crypto');
const { pool } = require('../db/pool');

const PEPPER = process.env.PASSWORD_PEPPER || 'vp-pepper-change-me';

async function authRoutes(fastify) {

  // ── POST /auth/login ────────────────────────────────────────────────────────
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;

    // Normalise to match the n8n Code: Validate + Pepper node behaviour
    const normalisedUsername = username.trim().toLowerCase();

    // Pepper + SHA512 hex digest — matches n8n Crypto: Hash Input node output
    const hashedPassword = crypto
      .createHash('sha512')
      .update(PEPPER + password)
      .digest('hex');

    const { rows } = await pool.query(
      `SELECT id, username, role, full_name, tenant_id
       FROM   bookings.staff_users
       WHERE  username        = $1
         AND  hashed_password = $2
         AND  is_active       = TRUE`,
      [normalisedUsername, hashedPassword]
    );

    if (rows.length === 0) {
      return reply.code(401).send({
        success: false,
        code:    'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const user = rows[0];

    // Sign JWT — payload includes both id and user_id so auth middleware
    // normalisation (Pattern 1) always finds a valid user_id regardless of
    // which claim name the token consumer checks.
    const token = fastify.jwt.sign({
      id:        user.id,
      user_id:   user.id,
      username:  user.username,
      role:      user.role,
      full_name: user.full_name,
      tenant_id: user.tenant_id,
    });

    // Return shape matches login.html expectations:
    //   data.token       → stored as vp_token
    //   data.user        → stored as vp_user (JSON)
    //   data.user.tenant_id → stored as vp_tenant_id
    return reply.send({
      success: true,
      token,
      user: {
        id:        user.id,
        username:  user.username,
        role:      user.role,
        full_name: user.full_name,
        tenant_id: user.tenant_id,
      },
    });
  });

}

module.exports = authRoutes;
