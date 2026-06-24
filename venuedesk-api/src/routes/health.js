'use strict';

/**
 * /health routes — platform liveness and telemetry.
 *
 * GET  /health/ping   — unauthenticated; returns 200 immediately for latency
 *                       measurement by the onboarding dashboard telemetry panel.
 * POST /health/pulse  — authenticated (service JWT); stores a heartbeat snapshot
 *                       from the n8n 5-minute cron in bookings.system_health.
 */

const { systemQuery } = require('../db/pool');

async function healthRoutes(fastify) {

  // ── GET /health/ping ─────────────────────────────────────────────────────────
  // No auth — used by browser performance.now() latency loop.
  // Must return quickly; no DB round-trip.
  fastify.get('/ping', async (request, reply) => {
    return reply.send({ ok: true, ts: new Date().toISOString() });
  });

  // ── POST /health/pulse ───────────────────────────────────────────────────────
  // Called by n8n Cron: Health Pulse (*/5 * * * *) via service JWT.
  // Records a timestamped heartbeat in bookings.system_health so there is an
  // auditable trail that n8n and db-api were reachable at that time.
  fastify.post('/pulse', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          source:    { type: 'string' },
          timestamp: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  }, async (request, reply) => {
    const { source = 'n8n-cron', timestamp, ...rest } = request.body || {};

    await systemQuery(
      `INSERT INTO bookings.system_health (source, status, payload)
       VALUES ($1, 'ok', $2)`,
      [source, JSON.stringify({ timestamp: timestamp || new Date().toISOString(), ...rest })]
    );

    return reply.send({ ok: true, recorded_at: new Date().toISOString() });
  });
}

module.exports = healthRoutes;
