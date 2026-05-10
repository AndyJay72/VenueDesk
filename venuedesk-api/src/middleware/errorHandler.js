'use strict';

/**
 * Global Error Handler — Fastify plugin.
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the n8n Executions tab as the source of truth for runtime errors.
 *
 * Every unhandled route error is:
 *   1. Classified (validation | auth | not_found | internal)
 *   2. Persisted to bookings.system_logs via LoggerService
 *   3. Returned to the client as a consistent JSON envelope
 *
 * Also registers process-level handlers for uncaughtException /
 * unhandledRejection so background job failures are never silently lost.
 *
 * Usage (in server.js):
 *   fastify.register(require('./middleware/errorHandler'));
 */

const logger = require('../services/LoggerService');

async function errorHandlerPlugin(fastify) {

  // ── Route-level errors ───────────────────────────────────────────────────
  fastify.setErrorHandler(async (error, request, reply) => {
    const tenantId = request.user?.tenant_id ?? null;
    const source   = `${request.method} ${request.routerPath ?? request.url}`;

    let statusCode = error.statusCode ?? 500;
    let code       = 'INTERNAL_ERROR';

    // Fastify validation errors
    if (error.validation) {
      statusCode = 400;
      code       = 'VALIDATION_ERROR';
    } else if (statusCode === 401) {
      code = 'UNAUTHORIZED';
    } else if (statusCode === 403) {
      code = 'FORBIDDEN';
    } else if (statusCode === 404) {
      code = 'NOT_FOUND';
    } else if (statusCode === 409) {
      code = 'CONFLICT';
    }

    const level = statusCode >= 500 ? 'error' : 'warn';

    await logger[level](source, error.message, {
      code,
      statusCode,
      validation: error.validation ?? undefined,
      stack:      statusCode >= 500 ? error.stack : undefined,
    }, tenantId);

    return reply.status(statusCode).send({
      success: false,
      code,
      message: statusCode >= 500 ? 'An internal error occurred' : error.message,
    });
  });

  // ── 404 fallback ─────────────────────────────────────────────────────────
  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({
      success: false,
      code:    'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    });
  });
}

// ── Process-level safety net ─────────────────────────────────────────────────
// Catches errors from cron jobs and other async code running outside of
// Fastify's request lifecycle (the n8n equivalent of "Error" execution nodes).

process.on('unhandledRejection', async (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack   = reason instanceof Error ? reason.stack   : undefined;
  try {
    await logger.error('process', 'unhandledRejection', { message, stack });
  } catch {
    console.error('[FATAL] unhandledRejection and logger also failed:', message);
  }
});

process.on('uncaughtException', async (err) => {
  try {
    await logger.error('process', 'uncaughtException', { message: err.message, stack: err.stack });
  } catch {
    console.error('[FATAL] uncaughtException and logger also failed:', err.message);
  }
  // Give logger a tick to flush before exiting — PM2/Docker will restart.
  setTimeout(() => process.exit(1), 1000);
});

module.exports = errorHandlerPlugin;
