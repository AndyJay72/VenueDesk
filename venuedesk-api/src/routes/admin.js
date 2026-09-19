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

  // ── POST /admin/process-unpaid-lifecycle ─────────────────────────────────────
  // Cron-triggered daily sweep (08:00 via UnpaidBookingLifecycle n8n workflow).
  // Caller must hold role:'admin' — enforced by the scope preHandler above.
  //
  // Step 1 — Warnings: bulk-SET unpaid_warning_sent_at on bookings where the event
  //   is approaching the auto-cancel deadline (within cancel_days + 2 days).
  //   Returns the warned rows for the n8n workflow to loop over and email.
  //
  // Step 2 — Cancellations: capture pre-update data, then bulk-SET status='cancelled'
  //   + balance_due=0 on overdue unpaid bookings, and bulk-INSERT into
  //   bookings.cancellations with category='Failed to Pay'.
  //   Returns the cancelled rows for the n8n workflow to loop over and email.
  //
  // Uses systemQuery (superuser pool, bypasses RLS) — cross-tenant by design.
  // UNNEST bulk-insert avoids N+1 per-row statements; no $N type conflicts (Pattern 3).
  fastify.post('/process-unpaid-lifecycle', async () => {
    // ── Resolve auto_cancel_days setting (global default 7) ───────────────────
    const { rows: settingRows } = await systemQuery(
      `SELECT value FROM bookings.settings WHERE key = 'auto_cancel_unpaid_days' LIMIT 1`
    );
    const autoCancelDays = settingRows.length > 0
      ? (parseInt(settingRows[0].value, 10) || 7)
      : 7;
    const warnWindowDays = autoCancelDays + 2;

    // ── Step 1: Bulk-UPDATE warnings ──────────────────────────────────────────
    // $1::integer is used once as a multiplier for INTERVAL '1 day' — no 42P08 risk.
    const { rows: warnUpdated } = await systemQuery(
      `UPDATE bookings.confirmed_bookings
       SET    unpaid_warning_sent_at = NOW()
       WHERE  balance_due > 0
         AND  status NOT IN ('cancelled', 'fully_paid', 'paid', 'overridden')
         AND  unpaid_warning_sent_at IS NULL
         AND  COALESCE(booking_date, date_from) <= CURRENT_DATE + $1::integer * INTERVAL '1 day'
       RETURNING id, tenant_id, customer_id, room_id,
                 COALESCE(booking_date, date_from) AS event_date,
                 start_time, end_time, balance_due`,
      [warnWindowDays]
    );

    let warningsToSend = [];
    if (warnUpdated.length > 0) {
      const warnIds = warnUpdated.map(r => r.id);
      const { rows } = await systemQuery(
        `SELECT cb.id            AS booking_id,
                cb.tenant_id,
                cu.email         AS customer_email,
                cu.full_name     AS customer_name,
                r.name           AS room_name,
                ten.name         AS venue_name,
                COALESCE(cb.booking_date, cb.date_from)::text AS event_date,
                cb.start_time::text,
                cb.end_time::text,
                cb.balance_due::text
         FROM   bookings.confirmed_bookings cb
         JOIN   bookings.customers cu  ON cu.id         = cb.customer_id
         JOIN   bookings.rooms     r   ON r.id          = cb.room_id
         JOIN   bookings.tenants   ten ON ten.tenant_id = cb.tenant_id
         WHERE  cb.id = ANY($1::uuid[])`,
        [warnIds]
      );
      warningsToSend = rows;
    }

    // ── Step 2a: Pre-SELECT overdue unpaid bookings (capture before zeroing) ──
    // Must read balance_due and status BEFORE the UPDATE or they'll be 0/'cancelled'.
    const { rows: toCancel } = await systemQuery(
      `SELECT cb.id,
              cb.tenant_id,
              cb.customer_id,
              cb.room_id,
              cb.booking_date,
              cb.date_from,
              cb.date_to,
              cb.start_time,
              cb.end_time,
              cb.total_amount,
              cb.deposit_paid,
              cb.balance_due,
              cb.status,
              cu.email         AS customer_email,
              cu.full_name     AS customer_name,
              r.name           AS room_name,
              ten.name         AS venue_name,
              COALESCE(cb.booking_date, cb.date_from)::text AS event_date
       FROM   bookings.confirmed_bookings cb
       JOIN   bookings.customers cu  ON cu.id         = cb.customer_id
       JOIN   bookings.rooms     r   ON r.id          = cb.room_id
       JOIN   bookings.tenants   ten ON ten.tenant_id = cb.tenant_id
       WHERE  cb.balance_due > 0
         AND  cb.status NOT IN ('cancelled', 'fully_paid', 'paid', 'overridden')
         AND  COALESCE(cb.booking_date, cb.date_from) <= CURRENT_DATE + $1::integer * INTERVAL '1 day'`,
      [autoCancelDays]
    );

    let cancellationsToSend = [];
    if (toCancel.length > 0) {
      const cancelIds = toCancel.map(r => r.id);

      // ── Step 2b: Bulk UPDATE — mark cancelled, zero balance ───────────────
      await systemQuery(
        `UPDATE bookings.confirmed_bookings
         SET    status      = 'cancelled',
                balance_due = 0,
                updated_at  = NOW()
         WHERE  id = ANY($1::uuid[])`,
        [cancelIds]
      );

      // ── Step 2c: Bulk INSERT into cancellations via UNNEST ────────────────
      // Each $N appears exactly once with an explicit type cast — no 42P08 risk.
      // Literal strings for reason/cancelled_by/category are embedded in SQL
      // (not repeated $N in conflicting contexts).
      await systemQuery(
        `INSERT INTO bookings.cancellations
           (tenant_id, original_booking_id, customer_id, room_id,
            booking_date, date_from, date_to, start_time, end_time,
            total_amount, deposit_paid, balance_due,
            reason, cancelled_by, original_status, category, cancelled_at)
         SELECT
           unnest($1::integer[]),
           unnest($2::uuid[]),
           unnest($3::uuid[]),
           unnest($4::uuid[]),
           unnest($5::date[]),
           unnest($6::date[]),
           unnest($7::date[]),
           unnest($8::time[]),
           unnest($9::time[]),
           unnest($10::numeric[]),
           unnest($11::numeric[]),
           unnest($12::numeric[]),
           'Automatically cancelled — balance unpaid',
           'VenueDesk System',
           unnest($13::text[]),
           'Failed to Pay',
           NOW()`,
        [
          toCancel.map(r => r.tenant_id),
          toCancel.map(r => r.id),
          toCancel.map(r => r.customer_id),
          toCancel.map(r => r.room_id),
          toCancel.map(r => r.booking_date),
          toCancel.map(r => r.date_from),
          toCancel.map(r => r.date_to),
          toCancel.map(r => r.start_time),
          toCancel.map(r => r.end_time),
          toCancel.map(r => r.total_amount),
          toCancel.map(r => r.deposit_paid),
          toCancel.map(r => r.balance_due),
          toCancel.map(r => r.status),
        ]
      );

      cancellationsToSend = toCancel.map(r => ({
        booking_id:     r.id,
        tenant_id:      r.tenant_id,
        customer_email: r.customer_email,
        customer_name:  r.customer_name,
        room_name:      r.room_name,
        venue_name:     r.venue_name,
        event_date:     r.event_date,
        start_time:     r.start_time ? String(r.start_time).slice(0, 5) : null,
        end_time:       r.end_time   ? String(r.end_time).slice(0, 5)   : null,
        balance_due:    r.balance_due,
      }));
    }

    return {
      success:               true,
      auto_cancel_days:      autoCancelDays,
      warnings_to_send:      warningsToSend,
      cancellations_to_send: cancellationsToSend,
    };
  });
}


module.exports = adminRoutes;
