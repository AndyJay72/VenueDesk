'use strict';

/**
 * JWT Auth Middleware — Fastify plugin.
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Phase 3 of CLAUDE.md:
 *   - Verifies every request carries a valid Bearer token
 *   - Extracts tenant_id from the JWT payload (NEVER from the request body)
 *   - Attaches decoded user context to request.user for downstream handlers
 *
 * Routes that opt in to auth must use:
 *   fastify.addHook('preHandler', fastify.authenticate)
 *
 * Or at the route level:
 *   { preHandler: [fastify.authenticate] }
 *
 * `fastify-plugin` is required to hoist the `authenticate` decorator out of
 * this plugin's encapsulation scope so sibling plugins (route modules) can
 * reference `fastify.authenticate`. It's a hard peer dep of @fastify/jwt,
 * so we import it unconditionally — no fallback needed.
 */

const fp          = require('fastify-plugin');
const { HttpError } = require('../utils/errors');

async function authPlugin(fastify) {
  // Fail fast at boot if the secret is missing — much better than
  // returning 500s at request time when tokens silently fail to verify.
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set (see .env.example §JWT AUTHENTICATION)');
  }

  await fastify.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET,
    sign:   { expiresIn: process.env.JWT_EXPIRY || '60m' },
  });

  fastify.decorate('authenticate', async function (request, reply) {
    try {
      // Token extraction — two sources (CLAUDE.md Pattern 4):
      //   1. Authorization: Bearer <token>  — n8n server-side calls (no CORS constraint)
      //   2. request.body.jwt              — browser POST (CORS blocks custom headers)
      // fastify.jwt.verify() validates signature + expiry from a raw token string,
      // bypassing the header-only extraction of jwtVerify().
      const headerRaw = (request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const bodyRaw   = (typeof request.body === 'object' && request.body !== null)
                          ? String(request.body.jwt || '')
                          : '';
      const rawToken  = headerRaw || bodyRaw;

      if (!rawToken) {
        throw new HttpError(401, 'Missing authentication token', 'UNAUTHORIZED');
      }

      request.user = fastify.jwt.verify(rawToken);

      // Enforce required payload fields per CLAUDE.md §3.2
      // Phase 2 note: n8n login workflow returns `id` (not `user_id`) from the
      // DB SELECT — accept either until the login WF is updated in Phase 3.
      const { user_id, id, tenant_id, role } = request.user;
      const effectiveUserId = user_id || id;

      // Service-role tokens (used by scheduled jobs / chaser workflow) carry
      // role: 'service' but no tenant_id — they operate across all tenants via
      // withServiceContext. Flag the request so route handlers can branch safely.
      const isService = role === 'service';

      if (!effectiveUserId || !role) {
        throw new HttpError(401, 'Invalid token payload — must contain (user_id or id) and role', 'UNAUTHORIZED');
      }
      if (!isService && tenant_id == null) {
        throw new HttpError(401, 'Invalid token payload — user tokens must contain tenant_id', 'UNAUTHORIZED');
      }

      // Normalise: user_id for downstream handlers, isService flag for branching
      request.user.user_id  = effectiveUserId;
      request.user.isService = isService;
    } catch (err) {
      // Normalise to a single 401 envelope regardless of upstream cause
      // (expired, malformed, missing header, bad payload, bad signature).
      reply
        .code(err.statusCode || 401)
        .send({ success: false, code: err.code || 'UNAUTHORIZED', message: err.message });
    }
  });
}

// fastify-plugin lifts the decorator out of encapsulation scope so every
// route module can reference `fastify.authenticate`.
module.exports = fp(authPlugin, { name: 'auth-plugin' });
