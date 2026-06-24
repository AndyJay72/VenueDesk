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

// ── Helpers ───────────────────────────────────────────────────────────────────
// Masks a secret so it is never returned in full over the wire.
// Returns null when the value is absent.
const maskSecret = (val) => val ? `${val.slice(0, 7)}••••••••${val.slice(-4)}` : null;

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

  // ── POST /admin/payment-settings/load ─────────────────────────────────────
  // Returns current Stripe + BACS configuration for the authenticated tenant.
  // POST (not GET) so the JWT can travel in the request body (Pattern 4 — CORS).
  // Secret values are NEVER returned in full — boolean presence flags only.
  fastify.post('/payment-settings/load', {
    schema: {
      body: {
        type: 'object',
        properties: { jwt: { type: 'string' } }, // body-tunnel field
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const { rows } = await systemQuery(
      `SELECT
         is_stripe_enabled,
         stripe_publishable_key,
         CASE WHEN stripe_secret_key    IS NOT NULL AND stripe_secret_key    != '' THEN true ELSE false END AS has_secret_key,
         CASE WHEN stripe_webhook_secret IS NOT NULL AND stripe_webhook_secret != '' THEN true ELSE false END AS has_webhook_secret,
         bacs_account_name,
         bacs_sort_code,
         bacs_account_number
       FROM bookings.tenants
       WHERE tenant_id = $1`,
      [tenantId]
    );

    if (!rows.length) return { success: false, code: 'NOT_FOUND' };
    return { success: true, data: rows[0] };
  });

  // ── POST /admin/payment-settings/save ────────────────────────────────────
  // Saves Stripe + BACS configuration for the authenticated tenant.
  // Pass only the fields you want to update — omitted fields are left unchanged.
  // Secret key and webhook secret: pass empty string '' to leave unchanged.
  // jwt field is the Pattern 4 body-tunnel (CORS constraint).
  fastify.post('/payment-settings/save', {
    schema: {
      body: {
        type: 'object',
        properties: {
          jwt:                    { type: 'string' },   // Pattern 4 body-tunnel
          is_stripe_enabled:      { type: 'boolean' },
          stripe_publishable_key: { type: 'string' },
          stripe_secret_key:      { type: 'string' },  // write-only; never returned
          stripe_webhook_secret:  { type: 'string' },  // write-only; never returned
          bacs_account_name:      { type: 'string' },
          bacs_sort_code:         { type: 'string' },
          bacs_account_number:    { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      is_stripe_enabled,
      stripe_publishable_key,
      stripe_secret_key,
      stripe_webhook_secret,
      bacs_account_name,
      bacs_sort_code,
      bacs_account_number,
    } = request.body;

    // Build SET clause dynamically — only update fields that were explicitly provided.
    // Empty string for secret fields = leave unchanged (so UI can submit '' to skip update).
    const sets   = [];
    const params = [tenantId]; // $1 = tenant_id

    const push = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (is_stripe_enabled !== undefined)  push('is_stripe_enabled',      is_stripe_enabled);
    if (stripe_publishable_key !== undefined) push('stripe_publishable_key', stripe_publishable_key.trim());
    if (stripe_secret_key     && stripe_secret_key.trim())     push('stripe_secret_key',      stripe_secret_key.trim());
    if (stripe_webhook_secret && stripe_webhook_secret.trim()) push('stripe_webhook_secret',  stripe_webhook_secret.trim());
    if (bacs_account_name  !== undefined) push('bacs_account_name',  bacs_account_name.trim());
    if (bacs_sort_code     !== undefined) push('bacs_sort_code',     bacs_sort_code.trim());
    if (bacs_account_number !== undefined) push('bacs_account_number', bacs_account_number.trim());

    if (!sets.length) return { success: true, message: 'Nothing to update' };

    await systemQuery(
      `UPDATE bookings.tenants
       SET ${sets.join(', ')}
       WHERE tenant_id = $1`,
      params
    );

    return { success: true, message: 'Payment settings saved' };
  });

  // ── POST /admin/audit-log ─────────────────────────────────────────────────
  // Called by n8n OnboardingManager after every admin write (create_venue,
  // reset_password, toggle_venue). Server-to-server hop uses service JWT.
  // Body: { admin_id, target_tenant, action_type, timestamp, details }
  fastify.post('/audit-log', {
    schema: {
      body: {
        type: 'object',
        properties: {
          admin_id:      { type: 'string' },
          target_tenant: { type: 'integer' },
          action_type:   { type: 'string' },
          details:       { type: 'string' },
          timestamp:     { type: 'string' },
        },
        required: ['action_type'],
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const {
      admin_id     = 'super-admin',
      target_tenant,
      action_type,
      details,
      timestamp,
    } = request.body;

    await systemQuery(
      `INSERT INTO bookings.admin_audit_log
         (admin_id, target_tenant, action_type, details, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        admin_id,
        target_tenant || null,
        action_type,
        details       || null,
        timestamp     ? new Date(timestamp) : new Date(),
      ]
    );

    return { success: true };
  });

  // ── GET /admin/system-logs ────────────────────────────────────────────────
  // Returns admin_audit_log rows for the onboarding dashboard audit modal.
  // Proxied through n8n /onboarding/system-logs webhook (service JWT).
  fastify.get('/system-logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:       { type: 'integer', default: 100, maximum: 500 },
          action_type: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { limit = 100, action_type } = request.query;

    const conditions = [];
    const params     = [limit];

    if (action_type) {
      params.push(action_type);
      conditions.push(`action_type = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await systemQuery(
      `SELECT id, admin_id, target_tenant, action_type, details, timestamp, created_at
       FROM   bookings.admin_audit_log
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
