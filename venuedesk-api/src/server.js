'use strict';

/**
 * venuedesk-api — Fastify entry point.
 *
 * Route registration order matters:
 *   1. CORS + JWT plugins (must be before any route uses fastify.authenticate)
 *   2. Error handler
 *   3. Routes (each mounted at its prefix)
 *   4. Migrations (run once at boot, before server starts listening)
 *
 * Adding a new route file
 * ───────────────────────
 *   fastify.register(require('./routes/myroute'), { prefix: '/myroute' });
 *
 * stripe routes are registered at /stripe — includes:
 *   GET  /stripe/config
 *   POST /stripe/session
 *   POST /stripe/webhook
 */

require('dotenv').config();

const Fastify   = require('fastify');
const cors      = require('@fastify/cors');
const jwt       = require('@fastify/jwt');

const { runMigrations }     = require('./db/migrate');
const errorHandler          = require('./middleware/errorHandler');

const authRoutes         = require('./routes/auth');
const dashboardRoutes    = require('./routes/dashboard');
const accountsRoutes     = require('./routes/accounts');
const paymentsRoutes     = require('./routes/payments');
const configRoutes       = require('./routes/config');
const leadsRoutes        = require('./routes/leads');
const adminRoutes        = require('./routes/admin');
const onboardingRoutes   = require('./routes/onboarding');
const stripeRoutes       = require('./routes/stripe');        // ← Phase 2 Stripe integration
const auditRoutes        = require('./routes/audit');         // ← Audit log write endpoint
const bookingsRoutes     = require('./routes/bookings');      // ← Booking lifecycle
const recurringRoutes    = require('./routes/recurring');     // ← Recurring schedules + payments
const customersRoutes    = require('./routes/customers');     // ← CRM customer management
const usersRoutes        = require('./routes/users');         // ← Staff user management
const blockedDatesRoutes = require('./routes/blocked-dates'); // ← Blocked date rules

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';

// ── Build Fastify instance ────────────────────────────────────────────────────
const fastify = Fastify({
  logger:           IS_DEV,
  disableRequestLogging: !IS_DEV,
  trustProxy:       true,    // Traefik sits in front on production
});

// ── CORS ──────────────────────────────────────────────────────────────────────
// GitHub Pages frontend + n8n call the API.
// Custom headers (Authorization) must NOT be in the allowedHeaders list —
// sending Authorization triggers a CORS preflight that n8n doesn't handle.
// Per CLAUDE.md Pattern 4: JWT travels via request body, not headers.
fastify.register(cors, {
  origin: true,              // reflect request origin in dev; tighten in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
});

// ── JWT ───────────────────────────────────────────────────────────────────────
// fastify.authenticate is added as a decoration by @fastify/jwt.
// Auth middleware normalises both `id` and `user_id` claim names (Pattern 1).
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'change-me-in-production',
  sign:   { expiresIn: process.env.JWT_EXPIRY || '60m' },
  decode: { complete: false },
});

// Decorate fastify with authenticate helper (used as preHandler in routes)
// Pattern 4 — JWT body-tunnel: browsers cannot send Authorization headers cross-origin
// (CORS allowedHeaders is limited to Content-Type). We therefore accept the raw token
// from request.body.jwt (POST) or request.query.jwt (GET fallback) in addition to
// the standard Authorization header (used by n8n server-to-server calls).
fastify.decorate('authenticate', async (request, reply) => {
  try {
    // 1. Try standard Authorization header first (n8n, Postman, curl)
    try {
      await request.jwtVerify();
    } catch (_headerErr) {
      // 2. Fall back to body/query jwt tunnel (browser cross-origin POST)
      const raw = request.body?.jwt || request.query?.jwt || '';
      if (!raw) throw new Error('No token provided');
      request.user = fastify.jwt.verify(raw);
    }

    // Pattern 1 — normalise id vs user_id claim name
    const p = request.user;
    if (!p.user_id && p.id) p.user_id = p.id;
    if (!p.user_id || !p.tenant_id) {
      return reply.code(401).send({
        success: false,
        code:    'INVALID_TOKEN',
        message: 'Token is missing required claims (user_id, tenant_id, role)',
      });
    }
  } catch (err) {
    return reply.code(401).send({
      success: false,
      code:    'UNAUTHORIZED',
      message: err.message,
    });
  }
});

// ── Global error handler ──────────────────────────────────────────────────────
errorHandler(fastify);

// ── Routes ────────────────────────────────────────────────────────────────────
fastify.register(authRoutes,       { prefix: '/auth'       });
fastify.register(dashboardRoutes,  { prefix: '/dashboard'  });
fastify.register(accountsRoutes,   { prefix: '/accounts'   });
fastify.register(paymentsRoutes,   { prefix: '/payments'   });
fastify.register(configRoutes,     { prefix: '/config'     });
fastify.register(leadsRoutes,      { prefix: '/leads'      });
fastify.register(adminRoutes,      { prefix: '/admin'      });
fastify.register(onboardingRoutes,   { prefix: '/onboarding'    });
fastify.register(stripeRoutes,       { prefix: '/stripe'        }); // ← Stripe integration
fastify.register(auditRoutes,        { prefix: '/audit'         }); // ← Audit log writes
fastify.register(bookingsRoutes,     { prefix: '/bookings'      }); // ← Booking lifecycle
fastify.register(recurringRoutes,    { prefix: '/recurring'     }); // ← Recurring schedules
fastify.register(customersRoutes,    { prefix: '/customers'     }); // ← CRM customers
fastify.register(usersRoutes,        { prefix: '/users'         }); // ← Staff users
fastify.register(blockedDatesRoutes, { prefix: '/blocked-dates' }); // ← Blocked date rules

// ── Health check ──────────────────────────────────────────────────────────────
fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await runMigrations();
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[server] venuedesk-api listening on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
