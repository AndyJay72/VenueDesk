'use strict';

/**
 * /admin routes — internal ops only.
 * All routes require `role: 'admin'` in the JWT.
 *
 * GET  /admin/jobs          — list all registered cron jobs from JOB_REGISTRY
 * POST /admin/run-job       — manually trigger any job (202 + queued)
 * GET  /admin/logs          — query bookings.system_logs
 * GET  /admin/scheduler-health — quick view of recent SchedulerService log entries
 */

const SchedulerService = require('../services/SchedulerService');
const { systemQuery }  = require('../db/pool');

async function adminRoutes(fastify) {

  // Enforce admin role on every route in this scope
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (request.user?.role !== 'admin') {
      reply.code(403).send({ success: false, code: 'FORBIDDEN', message: 'Admin role required' });
    }
  });

  // GET /admin/jobs — list all registered cron jobs (from JOB_REGISTRY, not hardcoded)
  fastify.get('/jobs', async () => {
    return { success: true, data: SchedulerService.listJobs() };
  });

  // POST /admin/run-job — manually fire a cron job (returns 202 immediately)
  // Job name is validated by SchedulerService.runManual() against JOB_REGISTRY,
  // so no hardcoded enum here — the registry is the single source of truth.
  fastify.post('/run-job', {
    schema: {
      body: {
        type: 'object',
        properties: { job: { type: 'string' } },
        required: ['job'],
      },
    },
  }, async (request, reply) => {
    const result = await SchedulerService.runManual(request.body.job);
    return reply.code(202).send({ success: true, ...result });
  });

  // GET /admin/logs — query bookings.system_logs
  fastify.get('/logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          level:  { type: 'string', enum: ['info', 'warn', 'error'] },
          source: { type: 'string' },
          limit:  { type: 'integer', default: 100, maximum: 500 },
        },
      },
    },
  }, async (request) => {
    const { level, source, limit = 100 } = request.query;

    // Build WHERE clause dynamically based on provided filters
    const conditions = [];
    const params     = [limit];

    if (level) {
      params.push(level);
      conditions.push(`level = $${params.length}`);
    }
    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await systemQuery(
      `SELECT id, level, source, message, detail, tenant_id, created_at
       FROM   bookings.system_logs
       ${where}
       ORDER  BY created_at DESC
       LIMIT  $1`,
      params
    );

    return { success: true, data: rows, count: rows.length };
  });

  // GET /admin/scheduler-health
  // Convenience endpoint — equivalent to:
  //   SELECT * FROM bookings.system_logs WHERE source = 'SchedulerService' ORDER BY created_at DESC LIMIT 50;
  // Returns the last run result for each job so you can verify the system is healthy
  // without needing direct DB access.
  fastify.get('/scheduler-health', async () => {
    const { rows } = await systemQuery(`
      SELECT DISTINCT ON (detail->>'job')
        id,
        level,
        message,
        detail,
        created_at
      FROM   bookings.system_logs
      WHERE  source  = 'SchedulerService'
        AND  detail->>'job' IS NOT NULL
      ORDER  BY detail->>'job', created_at DESC
    `);

    // Annotate each row with a human-readable health status
    const data = rows.map(r => ({
      job:         r.detail?.job,
      lastRun:     r.created_at,
      status:      r.detail?.status ?? (r.level === 'error' ? 'error' : 'unknown'),
      elapsed:     r.detail?.elapsed ?? null,
      triggeredBy: r.detail?.triggeredBy ?? null,
      message:     r.message,
    }));

    // Flag any jobs that have never run or last ran with an error
    const registered = SchedulerService.listJobs().map(j => j.name);
    const ranJobs    = new Set(data.map(d => d.job));
    const neverRan   = registered.filter(n => !ranJobs.has(n));

    return {
      success: true,
      data,
      neverRan,
      healthy: data.every(d => d.status === 'success') && neverRan.length === 0,
    };
  });
}

module.exports = adminRoutes;
