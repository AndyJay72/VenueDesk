'use strict';

require('dotenv').config();

const Fastify      = require('fastify');
const cors         = require('@fastify/cors');
const { runMigrations } = require('./db/migrate');
const SchedulerService  = require('./services/SchedulerService');
const errorHandler      = require('./middleware/errorHandler');
const authPlugin        = require('./middleware/auth');

/**
 * VenueDesk API v2 — n8n-free.
 * Boot sequence:
 *   1. Wait for the 'postgres' container to accept connections (retry × 5)
 *   2. Run startup DB migrations (idempotent)
 *   3. Register Fastify plugins (CORS, JWT auth, error handler)
 *   4. Register route modules
 *   5. Start HTTP server on 0.0.0.0 (Docker port-forwarding requirement)
 *   6. Start cron scheduler
 */

// ── DB readiness probe ────────────────────────────────────────────────────────
// The 'postgres' service takes a few seconds to boot inside Docker Compose.
// We retry a lightweight SELECT 1 up to MAX_RETRIES times before giving up.
const DB_RETRY_MAX   = 5;
const DB_RETRY_DELAY = 3_000; // ms between attempts

async function waitForDb() {
  const { pool } = require('./db/pool');

  for (let attempt = 1; attempt <= DB_RETRY_MAX; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('[server] database connection established');
      return;
    } catch (err) {
      console.warn(
        `[server] DB not ready — attempt ${attempt}/${DB_RETRY_MAX}: ${err.message}`
      );
      if (attempt === DB_RETRY_MAX) {
        throw new Error(
          `[server] Database unavailable after ${DB_RETRY_MAX} attempts — aborting`
        );
      }
      await new Promise(r => setTimeout(r, DB_RETRY_DELAY));
    }
  }
}

// ── App factory ───────────────────────────────────────────────────────────────
async function build() {
  const fastify = Fastify({
    logger: {
      level:     process.env.NODE_ENV === 'production' ? 'warn' : 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin:  true,   // Restrict to specific origins in production
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(authPlugin);
  await fastify.register(errorHandler);

  // ── Routes ───────────────────────────────────────────────────────────────
  /**
   * Health endpoint — reflects live DB connectivity so orchestrators and
   * load-balancers can distinguish "process alive" from "fully ready".
   *
   * Response shape:
   *   { status: 'ok'|'degraded', version, ts, database: { status: 'ok'|'error', error? } }
   */
  fastify.get('/health', async (_req, reply) => {
    let dbStatus = 'ok';
    let dbError  = null;

    try {
      const { pool } = require('./db/pool');
      await pool.query('SELECT 1');
    } catch (err) {
      dbStatus = 'error';
      dbError  = err.message;
    }

    const overall = dbStatus === 'ok' ? 'ok' : 'degraded';

    reply.code(overall === 'ok' ? 200 : 503).send({
      status:   overall,
      version:  '2.0.0',
      ts:       new Date().toISOString(),
      database: {
        status: dbStatus,
        ...(dbError && { error: dbError }),
      },
    });
  });

  await fastify.register(require('./routes/auth'),          { prefix: '/auth'           });
  await fastify.register(require('./routes/dashboard'),     { prefix: '/dashboard'      });
  await fastify.register(require('./routes/accounts'),      { prefix: '/accounts'       });
  await fastify.register(require('./routes/leads'),         { prefix: '/leads'          });
  await fastify.register(require('./routes/customers'),     { prefix: '/customers'      });
  await fastify.register(require('./routes/bookings'),      { prefix: '/bookings'       });
  await fastify.register(require('./routes/recurring'),     { prefix: '/recurring'      });
  await fastify.register(require('./routes/payments'),      { prefix: '/payments'       });
  await fastify.register(require('./routes/admin'),         { prefix: '/admin'          });
  await fastify.register(require('./routes/users'),         { prefix: '/users'          });
  await fastify.register(require('./routes/config'),        { prefix: '/config'         });
  await fastify.register(require('./routes/blocked-dates'), { prefix: '/blocked-dates'  });

  return fastify;
}

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function start() {
  // Step 1 — Block until 'postgres' container is ready (Docker Compose ordering)
  await waitForDb();

  // Step 2 — DB migrations before routes register
  await runMigrations();

  // Step 3 — Build Fastify app
  const fastify = await build();

  // Step 4 — Bind to 0.0.0.0 so Docker port-forwarding works
  const port = parseInt(process.env.PORT || '3000');
  await fastify.listen({ port, host: '0.0.0.0' });
  fastify.log.info(`VenueDesk API v2 listening on :${port}`);

  // Step 5 — Start cron scheduler (after server is accepting traffic)
  SchedulerService.start();

  // Step 6 — Graceful shutdown
  const shutdown = async (signal) => {
    fastify.log.info(`${signal} received — shutting down`);
    SchedulerService.stop();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
