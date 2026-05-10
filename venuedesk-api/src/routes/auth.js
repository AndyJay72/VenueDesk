'use strict';

/**
 * /auth routes — Phase 2 login migration.
 * Replaces: DB: Verify User (Postgres node) in B1NXZMSxwOD6bDHB (Staff Login WF).
 *
 * POST /auth/login  — verify staff credentials, return user row for JWT signing in n8n
 *
 * Design decisions:
 *   - No authenticate middleware: this is the credential-verification endpoint,
 *     no JWT exists yet at call time.
 *   - Pepper + SHA512 hashing is done server-side (CLAUDE.md Pattern 5 principle:
 *     security logic must not live in the orchestration layer).
 *   - PEPPER env var must exactly match the constant baked into existing DB hashes.
 *     If it changes, all staff passwords must be reset.
 *   - Uses pool directly (no withTenantContext) — login queries across all tenants
 *     by username; tenant isolation is enforced post-login via JWT + RLS.
 *   - Returns the raw user row on success (id, username, role, full_name, tenant_id).
 *     JWT signing remains in n8n (uses the n8n JWT credential store).
 *   - Generic 401 on any credential failure — no enumeration hints.
 */

const crypto    = require('crypto');
const { pool }  = require('../db/pool');

// Must match the pepper used when passwords were originally hashed in n8n.
// Set PASSWORD_PEPPER in .env — never hard-code the production value here.
const PEPPER = process.env.PASSWORD_PEPPER || 'vp-pepper-change-me-in-env';

async function authRoutes(fastify) {

  // ─── POST /auth/login ──────────────────────────────────────────────────────
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

    // Normalise: trim + lowercase (matches n8n Code: Validate + Pepper)
    const normalisedUsername = username.trim().toLowerCase();

    // Pepper + SHA512 hex digest (matches n8n Crypto: Hash Input node output)
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
      // Deliberately generic — prevents username enumeration
      return reply.code(401).send({
        success: false,
        code:    'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    return { success: true, data: rows[0] };
  });

}

module.exports = authRoutes;
