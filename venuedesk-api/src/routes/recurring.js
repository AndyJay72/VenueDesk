'use strict';

/**
 * /recurring routes — Phase 2 migration.
 * Replaces ALL Postgres nodes in:
 *   CreateRecurringBooking        (WF-CRB)
 *   CreateRecurringFromCalendar   (WF-CRFC)
 *
 * Endpoints:
 *   POST /recurring/upsert-customer         — shared: upsert by email/phone + set contract type
 *   POST /recurring/create-rule             — CRB: insert into recurring_rules
 *   POST /recurring/create-series           — CRB: insert into recurring_series
 *   POST /recurring/create-series-calendar  — CRFC: insert into recurring_series (aliases as rule)
 *   POST /recurring/insert-bookings         — shared: bulk insert confirmed_bookings from CSV
 *   POST /recurring/insert-payment-schedule — CRB: insert recurring_payment_schedule from CSVs
 *   POST /recurring/record-payment          — CRFC: conditional payment insert
 *   POST /recurring/log-interaction         — CRFC: customer_interactions insert
 *
 * Architectural invariants (CLAUDE.md):
 *   - tenant_id from JWT only, never from the request body.
 *   - All writes inside withTenantContext (SET LOCAL app.tenant_id via set_config).
 *   - Pattern 3: composite strings built in JS to prevent 42P08 type conflicts.
 */

const { withTenantContext, withServiceContext } = require('../db/pool');
const logger                = require('../services/LoggerService');
const { notFound, unprocessable } = require('../utils/errors');
const { assertUUID }        = require('../utils/validators');

async function recurringRoutes(fastify) {

  // ─── POST /recurring/upsert-customer ─────────────────────────────────────
  // Shared by CRB + CRFC.
  // Upserts a customer by email/phone match (priority: email > phone).
  // If neither matches, inserts a new record.
  // Always sets customer_type = 'contract' on the resolved record (non-fatal if column absent).
  //
  // Body:
  //   customer_name   string  required
  //   customer_email  string  optional — used as primary lookup key
  //   customer_phone  string  optional — used as fallback lookup key
  //
  // Returns: { customer_id, full_name, email, phone, is_new }
  fastify.post('/upsert-customer', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_name'],
        properties: {
          customer_name:  { type: 'string' },
          customer_email: { type: 'string', default: '' },
          customer_phone: { type: 'string', default: '' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_name,
      customer_email = '',
      customer_phone = '',
    } = request.body;

    const name  = customer_name.trim();
    const email = customer_email.trim().toLowerCase();
    const phone = customer_phone.trim();

    return withTenantContext(tenantId, async (client) => {
      // CTE: find existing → update → insert if not found.
      // Parameter order: $1=tenant_id, $2=email, $3=phone, $4=name
      const { rows } = await client.query(
        `WITH existing AS (
           SELECT id AS customer_id, full_name, email, phone, false AS is_new
           FROM   bookings.customers
           WHERE  (
                    (lower(email) = lower(NULLIF($2, '')) AND NULLIF($2, '') IS NOT NULL)
                    OR phone = NULLIF($3, '')
                  )
             AND  tenant_id = $1
           ORDER  BY created_at ASC
           LIMIT  1
         ),
         updated AS (
           UPDATE bookings.customers
           SET
             full_name = CASE
               WHEN lower(email) = lower(NULLIF($2,'')) AND NULLIF($2,'') IS NOT NULL THEN $4
               ELSE full_name
             END,
             email = CASE
               WHEN NULLIF($2,'') IS NOT NULL THEN NULLIF($2,'')
               ELSE email
             END,
             phone = COALESCE(NULLIF($3,''), phone)
           WHERE  id = (SELECT customer_id FROM existing)
             AND  tenant_id = $1
           RETURNING id AS customer_id, full_name, email, phone, false AS is_new
         ),
         inserted AS (
           INSERT INTO bookings.customers (tenant_id, full_name, email, phone)
           SELECT $1, $4, NULLIF($2,''), NULLIF($3,'')
           WHERE  NOT EXISTS (SELECT 1 FROM existing)
           ON CONFLICT DO NOTHING
           RETURNING id AS customer_id, full_name, email, phone, true AS is_new
         )
         SELECT * FROM updated
         UNION ALL SELECT * FROM inserted
         LIMIT 1`,
        [tenantId, email, phone, name]
      );

      if (!rows.length) {
        throw unprocessable(
          'Could not upsert customer — no match found and insert was skipped ' +
          '(missing email/phone, or ON CONFLICT suppressed). Supply at least one of email or phone.'
        );
      }

      const customer = rows[0];

      // Set contract type — continueOnFail semantics (column may not exist on older schemas)
      await client.query(
        `UPDATE bookings.customers
         SET    customer_type = 'contract'
         WHERE  id = $1::uuid
           AND  tenant_id = $2`,
        [customer.customer_id, tenantId]
      ).catch(() => { /* non-fatal */ });

      await logger.info(
        'RecurringRoute',
        `Customer upserted (recurring): ${customer.customer_id} is_new=${customer.is_new}`,
        { customer_id: customer.customer_id, is_new: customer.is_new, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: customer };
    });
  });


  // ─── POST /recurring/create-rule ─────────────────────────────────────────
  // CRB only — inserts one row into recurring_rules.
  // Generates a series_reference via the bookings.series_reference_seq sequence.
  //
  // Returns: { rule_id, series_reference }
  fastify.post('/create-rule', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id'],
        properties: {
          customer_id:       { type: 'string' },
          room_id:           { type: 'string' },
          day_of_week:       { type: 'integer',           default: 1  },
          start_time:        { type: 'string',            default: '' },
          end_time:          { type: 'string',            default: '' },
          rate_per_session:  { type: 'number',            default: 0  },
          frequency:         { type: 'string',            default: 'weekly' },
          end_date:          { type: 'string',            default: '' },
          billing_day:       { type: ['integer', 'null'], default: null },
          total_months:      { type: ['integer', 'null'], default: null },
          upfront_paid:      { type: 'boolean',           default: false },
          monthly_fee:       { type: 'number',            default: 0  },
          payment_timing:    { type: 'string',            default: 'in_advance' },
          billing_frequency: { type: 'string',            default: 'monthly' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      day_of_week       = 1,
      start_time        = '',
      end_time          = '',
      rate_per_session  = 0,
      frequency         = 'weekly',
      end_date          = '',
      billing_day       = null,
      total_months      = null,
      upfront_paid      = false,
      monthly_fee       = 0,
      payment_timing    = 'in_advance',
      billing_frequency = 'monthly',
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');

    return withTenantContext(tenantId, async (client) => {
      // Pattern 3 — all string-buildable values pre-computed in JS to avoid
      // $N reuse across differing PostgreSQL type inference contexts.
      const rateStr    = String(rate_per_session || 0);
      const feeStr     = String(monthly_fee      || 0);
      const upfrontStr = upfront_paid ? 'true' : 'false';

      const { rows: [rule] } = await client.query(
        `INSERT INTO bookings.recurring_rules
           (tenant_id, customer_id, room_id,
            day_of_week, start_time, end_time,
            rate_per_session, active, frequency, end_date,
            billing_day, total_months, upfront_paid,
            series_reference, monthly_fee, payment_timing, billing_frequency)
         VALUES
           ($1, $2::uuid, $3::uuid,
            $4,
            NULLIF($5,'')::time,
            NULLIF($6,'')::time,
            NULLIF($7,'')::numeric,
            TRUE,
            $8,
            NULLIF($9,'')::date,
            $10,
            $11,
            $12::boolean,
            'RB-' || nextval('bookings.series_reference_seq')::text,
            NULLIF($13,'')::numeric,
            COALESCE(NULLIF($14,''), 'in_advance'),
            COALESCE(NULLIF($15,''), 'monthly'))
         RETURNING id AS rule_id, series_reference`,
        [
          tenantId, customer_id, room_id,
          day_of_week,
          start_time,
          end_time,
          rateStr,
          frequency,
          end_date,
          billing_day,
          total_months,
          upfrontStr,
          feeStr,
          payment_timing,
          billing_frequency,
        ]
      );

      await logger.info(
        'RecurringRoute',
        `Recurring rule created: ${rule.rule_id}`,
        { rule_id: rule.rule_id, customer_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: rule };
    });
  });


  // ─── POST /recurring/create-series ───────────────────────────────────────
  // CRB only — inserts one row into recurring_series.
  // agreed_price = rate_per_session × total_sessions (computed in JS, Pattern 3).
  //
  // Returns: { series_id, agreed_price }
  fastify.post('/create-series', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id'],
        properties: {
          customer_id:       { type: 'string' },
          room_id:           { type: 'string' },
          series_name:       { type: 'string',  default: 'Recurring Session' },
          frequency:         { type: 'string',  default: 'weekly' },
          start_date:        { type: 'string',  default: '' },
          end_date:          { type: 'string',  default: '' },
          start_time:        { type: 'string',  default: '' },
          end_time:          { type: 'string',  default: '' },
          rate_per_session:  { type: 'number',  default: 0 },
          total_sessions:    { type: 'integer', default: 0 },
          billing_frequency: { type: 'string',  default: 'monthly' },
          payment_timing:    { type: 'string',  default: 'in_advance' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      series_name       = 'Recurring Session',
      frequency         = 'weekly',
      start_date        = '',
      end_date          = '',
      start_time        = '',
      end_time          = '',
      rate_per_session  = 0,
      total_sessions    = 0,
      billing_frequency = 'monthly',
      payment_timing    = 'in_advance',
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');

    // Pattern 3 — agreed_price computed in JS (same value fills three columns)
    const agreed_price = parseFloat((rate_per_session * total_sessions).toFixed(2));
    const agreedStr    = String(agreed_price);
    const rateStr      = String(rate_per_session || 0);

    return withTenantContext(tenantId, async (client) => {
      const { rows: [series] } = await client.query(
        `INSERT INTO bookings.recurring_series
           (tenant_id, customer_id, room_id,
            series_name, frequency,
            start_date, end_date,
            start_time, end_time,
            rate_per_session, total_sessions,
            agreed_price, cycle_amount, balance_due,
            billing_type, payment_timing,
            status, active)
         VALUES
           ($1, $2::uuid, $3::uuid,
            $4, $5,
            NULLIF($6,'')::date, NULLIF($7,'')::date,
            NULLIF($8,'')::time, NULLIF($9,'')::time,
            $10::numeric, $11::integer,
            $12::numeric, $12::numeric, $12::numeric,
            COALESCE(NULLIF($13,''), 'monthly'),
            COALESCE(NULLIF($14,''), 'in_advance'),
            'active', true)
         RETURNING id AS series_id, agreed_price`,
        [
          tenantId, customer_id, room_id,
          series_name.trim(), frequency,
          start_date, end_date,
          start_time, end_time,
          rateStr, total_sessions,
          agreedStr,
          billing_frequency, payment_timing,
        ]
      );

      await logger.info(
        'RecurringRoute',
        `Recurring series created: ${series.series_id}`,
        { series_id: series.series_id, customer_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: series };
    });
  });


  // ─── POST /recurring/create-series-calendar ───────────────────────────────
  // CRFC only — inserts into recurring_series with the shape expected by the
  // calendar workflow. Returns aliases that match recurring_rules column names
  // so downstream nodes need no conditional branching.
  //
  // balance_due = MAX(0, cycle_amount - payment_amount) — upfront deduction.
  //
  // Returns: { rule_id, series_id, series_reference, series_name, cycle_amount, balance_due }
  fastify.post('/create-series-calendar', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id'],
        properties: {
          customer_id:    { type: 'string' },
          room_id:        { type: 'string' },
          series_name:    { type: 'string',  default: 'Block' },
          cycle_amount:   { type: 'number',  default: 0 },
          payment_amount: { type: 'number',  default: 0 },  // upfront → offsets balance_due
          start_time:     { type: 'string',  default: '' },
          end_time:       { type: 'string',  default: '' },
          frequency:      { type: 'string',  default: 'weekly' },
          end_date:       { type: 'string',  default: '' },
          day_of_week:    { type: 'integer', default: 1 },
          payment_timing: { type: 'string',  default: 'in_advance' },
          billing_type:   { type: 'string',  default: 'monthly' },
          notes:          { type: 'string',  default: '' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      series_name    = 'Block',
      cycle_amount   = 0,
      payment_amount = 0,
      start_time     = '',
      end_time       = '',
      frequency      = 'weekly',
      end_date       = '',
      day_of_week    = 1,
      payment_timing = 'in_advance',
      billing_type   = 'monthly',
      notes          = '',
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');

    // Pattern 3 — balance_due computed in JS, passed as separate parameter
    const balance_due = parseFloat(Math.max(0, cycle_amount - payment_amount).toFixed(2));
    const cycleStr    = String(cycle_amount  || 0);
    const balanceStr  = String(balance_due);

    return withTenantContext(tenantId, async (client) => {
      const { rows: [series] } = await client.query(
        `INSERT INTO bookings.recurring_series
           (tenant_id, customer_id, room_id,
            series_name, cycle_amount, balance_due,
            start_time, end_time,
            frequency, end_date, day_of_week,
            active, payment_timing, billing_type, notes)
         VALUES
           ($1, $2::uuid, $3::uuid,
            COALESCE(NULLIF($4,''), 'Block'),
            $5::numeric,
            $6::numeric,
            NULLIF($7,'')::time,
            NULLIF($8,'')::time,
            COALESCE(NULLIF($9,''), 'weekly'),
            NULLIF($10,'')::date,
            $11::integer,
            TRUE,
            COALESCE(NULLIF($12,''), 'in_advance'),
            COALESCE(NULLIF($13,''), 'monthly'),
            NULLIF($14,''))
         RETURNING
           id           AS rule_id,
           id           AS series_id,
           series_name  AS series_reference,
           series_name,
           cycle_amount,
           balance_due`,
        [
          tenantId, customer_id, room_id,
          series_name.trim(),
          cycleStr, balanceStr,
          start_time, end_time,
          frequency, end_date,
          day_of_week,
          payment_timing, billing_type,
          notes,
        ]
      );

      await logger.info(
        'RecurringRoute',
        `Recurring series-calendar created: ${series.series_id}`,
        { series_id: series.series_id, customer_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: series };
    });
  });


  // ─── POST /recurring/insert-bookings ─────────────────────────────────────
  // Shared by CRB + CRFC.
  // Bulk-inserts confirmed_bookings from a comma-separated ISO dates string.
  // Uses unnest() WITH ORDINALITY — single round-trip regardless of session count.
  //
  // Payment status split: sessions 1..paid_sessions_count are treated as already
  // paid (deposit_paid = rate, balance_due = 0); remaining sessions are pending
  // (deposit_paid = 0, balance_due = rate).
  //
  // Body:
  //   customer_id         UUID    required
  //   room_id             UUID    required
  //   dates_csv           string  required  — comma-separated ISO dates after clash filter
  //   start_time          string  optional  HH:MM
  //   end_time            string  optional  HH:MM
  //   rate_per_session    number  default 0 — stored as total_amount per session
  //   rule_id             UUID    optional  — CRB: sets recurring_rule_id; CRFC: omit/null
  //   series_id           UUID    optional  — sets recurring_series_id
  //   series_label        string  default 'Recurring'
  //   status              string  default 'confirmed'
  //   paid_sessions_count integer default 0 — how many leading sessions to mark as paid
  //
  // Returns: { data: [{booking_date, id}], booking_count, paid_sessions, unpaid_sessions }
  fastify.post('/insert-bookings', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id', 'dates_csv'],
        properties: {
          customer_id:         { type: 'string' },
          room_id:             { type: 'string' },
          dates_csv:           { type: 'string' },
          start_time:          { type: 'string',            default: '' },
          end_time:            { type: 'string',            default: '' },
          rate_per_session:    { type: 'number',            default: 0 },
          rule_id:             { type: ['string', 'null'],  default: null },
          series_id:           { type: ['string', 'null'],  default: null },
          series_label:        { type: 'string',            default: 'Recurring' },
          status:              { type: 'string',            default: 'confirmed' },
          paid_sessions_count: { type: 'integer',           default: 0 },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      dates_csv,
      start_time          = '',
      end_time            = '',
      rate_per_session    = 0,
      rule_id             = null,
      series_id           = null,
      series_label        = 'Recurring',
      status              = 'confirmed',
      paid_sessions_count = 0,
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');
    if (rule_id && rule_id !== 'null')     assertUUID(rule_id,   'rule_id');
    if (series_id && series_id !== 'null') assertUUID(series_id, 'series_id');

    const csv       = (dates_csv || '').trim();
    if (!csv) {
      return { success: true, data: [], booking_count: 0, paid_sessions: 0, unpaid_sessions: 0 };
    }

    // Pattern 3 — rate passed as string to avoid $N numeric/text type conflict
    const rateStr   = String(rate_per_session || 0);
    // Clamp to non-negative integer — guards against float/negative input
    const paidCount = Math.max(0, parseInt(paid_sessions_count) || 0);

    return withTenantContext(tenantId, async (client) => {
      // null rule_id / series_id are valid (NULL::uuid = NULL).
      // WITH ORDINALITY tracks session position (1-based) so the first paidCount
      // sessions get deposit_paid = rate / balance_due = 0, the rest are pending.
      const { rows } = await client.query(
        `INSERT INTO bookings.confirmed_bookings
           (tenant_id, customer_id, room_id,
            booking_date, date_from, date_to,
            start_time, end_time,
            total_amount, deposit_paid, balance_due,
            status, is_recurring,
            recurring_rule_id, recurring_series_id,
            series_label, updated_at)
         SELECT
           $1, $2::uuid, $3::uuid,
           t.d::date, t.d::date, t.d::date,
           NULLIF($5,'')::time,
           NULLIF($6,'')::time,
           $7::numeric,
           CASE WHEN t.ord <= $12::bigint THEN $7::numeric ELSE 0 END,
           CASE WHEN t.ord <= $12::bigint THEN 0 ELSE $7::numeric END,
           $10, TRUE,
           $8::uuid,
           $9::uuid,
           $11, NOW()
         FROM unnest(string_to_array($4, ',')) WITH ORDINALITY AS t(d, ord)
         WHERE $4 <> ''
         RETURNING booking_date::text, id::text`,
        [
          tenantId, customer_id, room_id,
          csv,
          start_time, end_time,
          rateStr,
          rule_id   || null,
          series_id || null,
          status,
          series_label,
          paidCount,
        ]
      );

      const paidSessions   = Math.min(paidCount, rows.length);
      const unpaidSessions = rows.length - paidSessions;

      await logger.info(
        'RecurringRoute',
        `Bulk bookings inserted: ${rows.length} sessions (${paidSessions} paid, ${unpaidSessions} pending)`,
        { customer_id, room_id, booking_count: rows.length, paid_sessions: paidSessions, unpaid_sessions: unpaidSessions, tenant_id: tenantId },
        tenantId
      );

      return {
        success:         true,
        data:            rows,
        booking_count:   rows.length,
        paid_sessions:   paidSessions,
        unpaid_sessions: unpaidSessions,
      };
    });
  });


  // ─── POST /recurring/insert-payment-schedule ─────────────────────────────
  // CRB only — bulk-inserts recurring_payment_schedule rows from parallel CSV arrays.
  // Uses unnest() WITH ORDINALITY to correlate period_start, period_end, amount_due.
  // ON CONFLICT DO NOTHING — idempotent on (recurring_rule_id, period_start).
  //
  // Body:
  //   rule_id        UUID    required
  //   customer_id    UUID    required
  //   periods_csv    string  required — comma-separated period_start dates
  //   ends_csv       string  required — comma-separated period_end dates
  //   amounts_csv    string  required — comma-separated amounts
  //   payment_timing string  default 'in_advance' — 'in_arrears' shifts due_date +7d
  //   total_months   int?    optional — used for total_cycles / remaining_cycles
  //   billing_day    int?    optional
  //   upfront_paid   bool    default false
  //
  // Returns: { data: [{id, period_start, amount_due, due_date}], schedule_count }
  fastify.post('/insert-payment-schedule', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['rule_id', 'customer_id', 'periods_csv', 'ends_csv', 'amounts_csv'],
        properties: {
          rule_id:        { type: 'string' },
          customer_id:    { type: 'string' },
          periods_csv:    { type: 'string' },
          ends_csv:       { type: 'string' },
          amounts_csv:    { type: 'string' },
          payment_timing: { type: 'string',            default: 'in_advance' },
          total_months:   { type: ['integer', 'null'], default: null },
          billing_day:    { type: ['integer', 'null'], default: null },
          upfront_paid:   { type: 'boolean',           default: false },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      rule_id,
      customer_id,
      periods_csv,
      ends_csv,
      amounts_csv,
      payment_timing = 'in_advance',
      total_months   = null,
      billing_day    = null,
      upfront_paid   = false,
    } = request.body;

    assertUUID(rule_id,     'rule_id');
    assertUUID(customer_id, 'customer_id');

    const csv = (periods_csv || '').trim();
    if (!csv) {
      return { success: true, data: [], schedule_count: 0 };
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.recurring_payment_schedule
           (tenant_id, recurring_rule_id, customer_id,
            period_start, period_end, amount_due, due_date,
            status, total_cycles, remaining_cycles,
            billing_day, upfront_paid, payment_timing)
         SELECT
           $1::int,
           $2::uuid,
           $3::uuid,
           ps::date,
           pe::date,
           amt::numeric,
           CASE
             WHEN $7 = 'in_arrears' THEN (pe::date + INTERVAL '7 days')::date
             ELSE ps::date
           END,
           'pending',
           $8,
           CASE WHEN $8 IS NOT NULL THEN GREATEST(0, $8 - rn::int) ELSE NULL END,
           $9,
           $10::boolean,
           $7
         FROM unnest(
           string_to_array($4, ','),
           string_to_array($5, ','),
           string_to_array($6, ',')
         ) WITH ORDINALITY AS t(ps, pe, amt, rn)
         ON CONFLICT (recurring_rule_id, period_start) DO NOTHING
         RETURNING id::text, period_start::text, amount_due::text, due_date::text`,
        [
          tenantId, rule_id, customer_id,
          periods_csv, ends_csv, amounts_csv,
          payment_timing,
          total_months,
          billing_day,
          upfront_paid ? 'true' : 'false',
        ]
      );

      return { success: true, data: rows, schedule_count: rows.length };
    });
  });


  // ─── POST /recurring/record-payment ──────────────────────────────────────
  // CRFC only — conditionally inserts a payment record.
  // Skipped (returns skipped: true) when payment_amount = 0 or payment_type = 'none'.
  // booking_id is NULL — this is a series-level payment, not tied to a single session.
  //
  // Body:
  //   customer_id       UUID    required
  //   payment_amount    number  default 0
  //   payment_type      string  default 'none'  — 'full' | 'deposit' | 'none' | other
  //   payment_method    string  default 'cash'
  //   series_reference  string  default ''      — used for reference_number prefix + stored
  //   series_id         UUID?   optional        — links payment to recurring_series row
  //
  // Phase 3 lifecycle fields (all optional — safe defaults, non-breaking):
  //   cycle_number      int?    default null    — 1 = initial cycle, null = legacy path
  //   period_start      string  default ''      — ISO date of this cycle's start
  //   period_end        string  default ''      — ISO date of this cycle's end
  //   cycle_amount      number  default 0       — per-cycle charge (may differ from payment_amount)
  //   billing_type      string  default 'monthly' — 'weekly'|'fortnightly'|'monthly'
  //   total_sessions    int     default 0       — total sessions in this series
  //
  // Phase 3 behaviour:
  //   When cycle_number <= 1 AND series_id AND period_start AND cycle_amount > 0,
  //   the handler atomically seeds TWO rows in recurring_payment_schedule:
  //     • Cycle 1 — status='paid'    (the payment we just captured)
  //     • Cycle 2 — status='pending' (next billing period, computed from billing_type)
  //   Both inserts use ON CONFLICT ... DO NOTHING (idempotent).
  //   Both are non-fatal — if the schema columns don't exist yet they silently skip.
  //
  // Returns: { data: {id, reference_number, series_reference, series_id}, skipped, schedule_count }
  fastify.post('/record-payment', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id'],
        properties: {
          customer_id:      { type: 'string' },
          payment_amount:   { type: 'number',            default: 0 },
          payment_type:     { type: 'string',            default: 'none' },
          payment_method:   { type: 'string',            default: 'cash' },
          series_reference: { type: 'string',            default: '' },
          series_id:        { type: ['string', 'null'],  default: null },
          // Phase 3 lifecycle fields
          cycle_number:     { type: ['integer', 'null'], default: null },
          period_start:     { type: 'string',            default: '' },
          period_end:       { type: 'string',            default: '' },
          cycle_amount:     { type: 'number',            default: 0 },
          billing_type:     { type: 'string',            default: 'monthly' },
          total_sessions:   { type: 'integer',           default: 0 },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      payment_amount   = 0,
      payment_type     = 'none',
      payment_method   = 'cash',
      series_reference = '',
      series_id        = null,
      // Phase 3 lifecycle fields
      cycle_number     = null,
      period_start     = '',
      period_end       = '',
      cycle_amount     = 0,
      billing_type     = 'monthly',
      total_sessions   = 0,
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    if (series_id) assertUUID(series_id, 'series_id');

    if (payment_amount <= 0 || payment_type === 'none') {
      return { success: true, data: null, skipped: true, reason: 'no_payment_required' };
    }

    // Pattern 3 — payment_type label and reference prefix built in JS.
    // Financial parity: recurring series payments must be typed 'recurring' so
    // accounts.html's payment ledger picks them up in the correct category.
    const paymentTypeLabel = series_id
      ? 'recurring'
      : payment_type === 'full'    ? 'full_payment'
      : payment_type === 'deposit' ? 'deposit'
      : 'payment';

    // Phase 3 — cycle number normalisation (must be above refBase so cycleLabel can use it).
    // cycle_number == null is treated as 1 (legacy callers that don't send the field).
    const effectiveCycleNum = cycle_number ?? 1;

    // Pattern 3 — build full reference base in JS to avoid $N type conflicts.
    // Cycle 1 (or legacy null): INIT label. Subsequent cycles: CYC{N}.
    const refPrefix  = (series_reference || 'CAL').trim();
    const cycleLabel = effectiveCycleNum <= 1 ? 'INIT' : `CYC${effectiveCycleNum}`;
    const refBase    = `${refPrefix}-${cycleLabel}`;
    const amtStr     = String(payment_amount);

    // Phase 3 — Cycle 1 detection: initial payment with enough context to seed the schedule.
    // We only seed when series_id is present (links to a known recurring_series row).
    const isInitialCycle    = effectiveCycleNum <= 1
      && !!series_id
      && !!(period_start || '').trim()
      && parseFloat(cycle_amount) > 0;

    // Pre-compute Cycle 2 dates in JS (Pattern 3 — avoids SQL date arithmetic $N conflicts)
    let c2Start = '', c2End = '';
    if (isInitialCycle) {
      const cycleDays = billing_type === 'weekly'       ? 7
                      : billing_type === 'fortnightly'  ? 14
                      : 28; // monthly ≈ 4 weeks
      const c1 = new Date(period_start);
      const d2 = new Date(c1.getTime() + cycleDays * 86_400_000);
      const d3 = new Date(d2.getTime() + cycleDays * 86_400_000 - 86_400_000);
      c2Start  = d2.toISOString().slice(0, 10);
      c2End    = d3.toISOString().slice(0, 10);
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.payments
           (booking_id, customer_id, payment_type, amount, payment_method,
            status, reference_number, tenant_id, payment_date, series_reference)
         VALUES
           (NULL,
            $1::uuid,
            $2,
            $3::numeric,
            $4,
            'completed',
            $5 || '-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MI') || '-' || LEFT(gen_random_uuid()::text, 8),
            $6::integer,
            NOW(),
            NULLIF($7,''))
         RETURNING id::text, reference_number, series_reference`,
        [
          customer_id,
          paymentTypeLabel,
          amtStr,
          payment_method,
          refBase,
          tenantId,
          series_reference,
        ]
      );

      const payment = rows[0] || null;

      // Link payment to recurring_series via UUID — non-fatal (column may not exist on older schemas)
      if (payment && series_id) {
        await client.query(
          `UPDATE bookings.payments
           SET recurring_series_id = $1::uuid
           WHERE id = $2::uuid`,
          [series_id, payment.id]
        ).catch(() => { /* non-fatal: recurring_series_id column may not exist yet */ });
      }

      // Audit trail — non-fatal (bookings.audit_logs may not exist on all deployments).
      // Pattern 3: structured label built in JS to avoid $N type conflicts.
      // action: 'payment_received' — consistent with the payment chaser's terminology.
      // details: human-readable string for the ledger strip on the dashboard.
      if (payment) {
        const seriesRef    = series_reference || payment.series_reference || 'N/A';
        const auditDetails = `Paid Block ${effectiveCycleNum} for Series ${seriesRef}`;
        await client.query(
          `INSERT INTO bookings.audit_logs
             (tenant_id, entity_type, entity_id, action, actor, details, created_at)
           VALUES ($1::integer, 'payment', $2, 'payment_received', 'VenueDesk API', $3, NOW())`,
          [tenantId, payment.id, auditDetails]
        ).catch(() => { /* non-fatal: audit_logs table may not exist yet */ });
      }

      // ── Phase 3: seed lifecycle schedule rows atomically ──────────────────
      // Both inserts live inside this same withTenantContext transaction so they
      // either both commit with the payment or both roll back on error.
      // Each is individually non-fatal — a missing column (pre-migration schema)
      // will silently skip without poisoning the outer transaction.
      let scheduleCount = 0;

      if (isInitialCycle) {
        const c1PeriodEnd = (period_end || '').trim() || period_start;
        const cycleAmt    = String(cycle_amount);

        await logger.info(
          'RecurringRoute [DRY-RUN]',
          'Intending to seed lifecycle schedule',
          {
            series_id,
            cycle_1: { period_start, period_end: c1PeriodEnd, status: 'paid',    amount: cycle_amount },
            cycle_2: { period_start: c2Start,    period_end:  c2End,   status: 'pending', amount: cycle_amount },
            billing_type,
            total_sessions,
          },
          tenantId
        );

        // Cycle 1 — paid (mirrors the deposit we just recorded)
        await client.query(
          `INSERT INTO bookings.recurring_payment_schedule
             (tenant_id, recurring_series_id, customer_id, cycle_number,
              period_start, period_end, amount_due, due_date,
              status, migration_source, payment_timing)
           VALUES
             ($1::int, $2::uuid, $3::uuid, 1,
              $4::date, $5::date, $6::numeric, $4::date,
              'paid', 'phase3', 'in_advance')
           ON CONFLICT (recurring_series_id, cycle_number)
             WHERE recurring_series_id IS NOT NULL AND cycle_number IS NOT NULL
           DO NOTHING`,
          [tenantId, series_id, customer_id, period_start, c1PeriodEnd, cycleAmt]
        ).then(r => { scheduleCount += r.rowCount; })
         .catch(() => { /* non-fatal: 004 migration may not have run yet */ });

        // Cycle 2 — pending (next billing period)
        await client.query(
          `INSERT INTO bookings.recurring_payment_schedule
             (tenant_id, recurring_series_id, customer_id, cycle_number,
              period_start, period_end, amount_due, due_date,
              status, migration_source, payment_timing)
           VALUES
             ($1::int, $2::uuid, $3::uuid, 2,
              $4::date, $5::date, $6::numeric, $4::date,
              'pending', 'phase3', 'in_advance')
           ON CONFLICT (recurring_series_id, cycle_number)
             WHERE recurring_series_id IS NOT NULL AND cycle_number IS NOT NULL
           DO NOTHING`,
          [tenantId, series_id, customer_id, c2Start, c2End, cycleAmt]
        ).then(r => { scheduleCount += r.rowCount; })
         .catch(() => { /* non-fatal: 004 migration may not have run yet */ });

      } else if (series_id && effectiveCycleNum > 1 && payment) {
        // ── Phase 3: advance an existing recurring series (cycle N → paid, seed cycle N+1) ──
        // Called when n8n sends cycle_number >= 2 after the customer pays their next block.
        //
        // Step 1: mark the target cycle as paid.
        await client.query(
          `UPDATE bookings.recurring_payment_schedule
           SET    status     = 'paid',
                  updated_at = NOW()
           WHERE  recurring_series_id = $1::uuid
             AND  cycle_number        = $2::int
             AND  tenant_id           = $3::int`,
          [series_id, effectiveCycleNum, tenantId]
        ).then(r => { scheduleCount += r.rowCount; })
         .catch(() => { /* non-fatal: 004 migration may not have run yet */ });

        // Step 2: seed the next cycle as pending (idempotent — ON CONFLICT DO NOTHING).
        // Only runs when enough context is available (period_start + cycle_amount).
        if ((period_start || '').trim() && parseFloat(cycle_amount) > 0) {
          const cycleDays = billing_type === 'weekly'      ? 7
                          : billing_type === 'fortnightly' ? 14
                          : 28; // monthly ≈ 4 weeks
          const cStart    = new Date(period_start);
          const nextD1    = new Date(cStart.getTime() + cycleDays * 86_400_000);
          const nextD2    = new Date(nextD1.getTime() + cycleDays * 86_400_000 - 86_400_000);
          const nStart    = nextD1.toISOString().slice(0, 10);
          const nEnd      = nextD2.toISOString().slice(0, 10);
          const cycleAmt  = String(cycle_amount);
          const nextCycle = effectiveCycleNum + 1;

          await client.query(
            `INSERT INTO bookings.recurring_payment_schedule
               (tenant_id, recurring_series_id, customer_id, cycle_number,
                period_start, period_end, amount_due, due_date,
                status, migration_source, payment_timing)
             VALUES
               ($1::int, $2::uuid, $3::uuid, $4::int,
                $5::date, $6::date, $7::numeric, $5::date,
                'pending', 'phase3', 'in_advance')
             ON CONFLICT (recurring_series_id, cycle_number)
               WHERE recurring_series_id IS NOT NULL AND cycle_number IS NOT NULL
             DO NOTHING`,
            [tenantId, series_id, customer_id, nextCycle, nStart, nEnd, cycleAmt]
          ).then(r => { scheduleCount += r.rowCount; })
           .catch(() => { /* non-fatal: 004 migration may not have run yet */ });
        }
      }

      await logger.info(
        'RecurringRoute',
        `Payment recorded: ${payment?.id} amount=${payment_amount} series=${series_id || 'none'} schedule_rows=${scheduleCount}`,
        { payment_id: payment?.id, customer_id, series_id, is_initial_cycle: isInitialCycle, schedule_count: scheduleCount, tenant_id: tenantId },
        tenantId
      );

      return {
        success:        true,
        data:           payment ? { ...payment, series_id: series_id || null } : null,
        skipped:        false,
        schedule_count: scheduleCount,
      };
    });
  });


  // ─── POST /recurring/seed-lifecycle-schedule ──────────────────────────────
  // CRFC / admin — bulk-seeds the full payment lifecycle for a recurring series.
  // Creates N rows (cycle 1 = paid, cycles 2..N = pending) from a single call.
  // Idempotent: ON CONFLICT (recurring_series_id, cycle_number) DO NOTHING.
  // Safe to call multiple times — duplicate cycles are silently skipped.
  //
  // Use this endpoint when:
  //   • total_sessions > 4 (enough cycles to warrant a full schedule upfront)
  //   • or the n8n workflow wants to pre-populate all pending cycles at once
  //
  // Body:
  //   series_id       UUID    required  — bookings.recurring_series.id
  //   customer_id     UUID    required
  //   cycle_amount    number  required  — per-cycle charge
  //   period_start    string  required  — ISO date of cycle 1 start
  //   billing_type    string  default 'monthly' — 'weekly'|'fortnightly'|'monthly'
  //   total_sessions  int     default 4 — how many cycles to create
  //
  // Returns: { data: [{cycle_number, period_start, period_end, status}], schedule_count }
  fastify.post('/seed-lifecycle-schedule', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['series_id', 'customer_id', 'cycle_amount', 'period_start'],
        properties: {
          series_id:      { type: 'string' },
          customer_id:    { type: 'string' },
          cycle_amount:   { type: 'number' },
          period_start:   { type: 'string' },
          billing_type:   { type: 'string',  default: 'monthly' },
          total_sessions: { type: 'integer', default: 4 },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      series_id,
      customer_id,
      cycle_amount,
      period_start,
      billing_type   = 'monthly',
      total_sessions = 4,
    } = request.body;

    assertUUID(series_id,   'series_id');
    assertUUID(customer_id, 'customer_id');

    if (parseFloat(cycle_amount) <= 0) {
      throw Object.assign(new Error('cycle_amount must be > 0'), { statusCode: 400 });
    }

    // Compute all N cycle date ranges in JS (Pattern 3 — no SQL date arithmetic $N conflicts)
    const cycleDays = billing_type === 'weekly'      ? 7
                    : billing_type === 'fortnightly' ? 14
                    : 28; // monthly ≈ 4 weeks

    const cycles = [];
    let cycleStart = new Date(period_start);
    const fmt = (d) => d.toISOString().slice(0, 10);

    for (let i = 1; i <= total_sessions; i++) {
      const cycleEnd = new Date(cycleStart.getTime() + cycleDays * 86_400_000- 86_400_000);
      cycles.push({
        cycle_number: i,
        period_start: fmt(cycleStart),
        period_end:   fmt(cycleEnd),
        status:       i === 1 ? 'paid' : 'pending',
      });
      cycleStart = new Date(cycleStart.getTime() + cycleDays * 86_400_000);
    }

    const amtStr = String(cycle_amount);

    return withTenantContext(tenantId, async (client) => {
      const inserted = [];

      for (const cycle of cycles) {
        const { rows } = await client.query(
          `INSERT INTO bookings.recurring_payment_schedule
             (tenant_id, recurring_series_id, customer_id, cycle_number,
              period_start, period_end, amount_due, due_date,
              status, migration_source, payment_timing)
           VALUES
             ($1::int, $2::uuid, $3::uuid, $4,
              $5::date, $6::date, $7::numeric, $5::date,
              $8, 'phase3', 'in_advance')
           ON CONFLICT (recurring_series_id, cycle_number)
             WHERE recurring_series_id IS NOT NULL AND cycle_number IS NOT NULL
           DO NOTHING
           RETURNING cycle_number, period_start::text, period_end::text, status`,
          [
            tenantId, series_id, customer_id, cycle.cycle_number,
            cycle.period_start, cycle.period_end, amtStr, cycle.status,
          ]
        );
        if (rows.length) inserted.push(rows[0]);
      }

      await logger.info(
        'RecurringRoute',
        `Lifecycle schedule seeded: ${inserted.length}/${total_sessions} cycles for series ${series_id}`,
        { series_id, customer_id, inserted_count: inserted.length, total_sessions, billing_type },
        tenantId
      );

      return { success: true, data: inserted, schedule_count: inserted.length };
    });
  });


  // ─── GET /recurring/pending-reminders ────────────────────────────────────
  // Phase 4 reminder workflow endpoint.
  // Returns pending recurring_payment_schedule rows (migration_source = 'phase3')
  // whose due_date falls within the next `days_ahead` days.
  // Joins customers for email dispatch context.
  //
  // Query params:
  //   days_ahead   int  default 7   — look-ahead window in days
  //   tenant_id    int  required    — passed via query param (CORS-safe, no auth header)
  //
  // Note: tenant_id from query param is used ONLY as a hint for withTenantContext —
  //       the JWT's tenant_id is authoritative and enforced by RLS.
  //
  // Returns: { data: [{schedule_id, cycle_number, period_start, period_end, due_date,
  //                    amount_due, customer_id, customer_name, customer_email,
  //                    series_id, migration_source}], count }
  fastify.get('/pending-reminders', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days_ahead: { type: 'integer', default: 7 },
        },
      },
    },
  }, async (request) => {
    const tenantId  = request.user.tenant_id;
    const daysAhead = parseInt(request.query.days_ahead ?? '7', 10);

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           rps.id::text                  AS schedule_id,
           rps.cycle_number,
           rps.period_start::text,
           rps.period_end::text,
           rps.due_date::text,
           rps.amount_due::text,
           rps.status,
           rps.migration_source,
           rps.recurring_series_id::text AS series_id,
           c.id::text                    AS customer_id,
           c.full_name                   AS customer_name,
           c.email                       AS customer_email
         FROM  bookings.recurring_payment_schedule rps
         JOIN  bookings.customers                  c
               ON c.id = rps.customer_id
              AND c.tenant_id = rps.tenant_id
         WHERE rps.tenant_id        = $1::int
           AND rps.migration_source = 'phase3'
           AND rps.status           = 'pending'
           AND rps.due_date         <= (CURRENT_DATE + ($2 || ' days')::interval)::date
           AND rps.due_date         >= CURRENT_DATE
         ORDER BY rps.due_date ASC, rps.cycle_number ASC`,
        [tenantId, String(daysAhead)]
      );

      await logger.info(
        'RecurringRoute',
        `Pending reminders fetched: ${rows.length} rows (days_ahead=${daysAhead})`,
        { count: rows.length, days_ahead: daysAhead, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: rows, count: rows.length };
    });
  });


  // ─── GET /recurring/next-due ─────────────────────────────────────────────
  // Returns the next pending/overdue payment block for every active series.
  // Uses DISTINCT ON (recurring_series_id) ORDER BY due_date ASC so only the
  // earliest outstanding cycle per series surfaces — drives the "Outstanding"
  // section on index.html's waterfall ledger.
  //
  // Returns: { data: [{schedule_id, series_id, cycle_number, period_start,
  //                    period_end, due_date, amount_due, status,
  //                    customer_name, customer_email, series_reference}], count }
  // No preHandler — browser GET cannot send Authorization header without CORS preflight.
  // Tenant scoped via query param (same pattern as /schedule-status).
  fastify.get('/next-due', {
    schema: {
      querystring: {
        type: 'object',
        required: ['tenant_id'],
        properties: {
          tenant_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const tenantId = parseInt(request.query.tenant_id, 10);
    if (!tenantId || isNaN(tenantId)) {
      return { success: false, code: 'BAD_REQUEST', message: 'tenant_id must be a valid integer' };
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT DISTINCT ON (rps.recurring_series_id)
           rps.id::text                  AS schedule_id,
           rps.recurring_series_id::text AS series_id,
           rps.cycle_number,
           rps.period_start::text,
           rps.period_end::text,
           rps.due_date::text,
           rps.amount_due::text,
           rps.status,
           c.full_name                              AS customer_name,
           c.email                                  AS customer_email,
           -- Resolve series_reference:
           --   Legacy CRB rows  → rps.recurring_rule_id → recurring_rules.series_reference
           --   Phase3 CRFC rows → rps.recurring_series_id → recurring_series.series_name (fallback)
           --   Last resort      → recurring_series_id UUID as string
           COALESCE(rr.series_reference, rs.series_name, rps.recurring_series_id::text)
                                                    AS series_reference
         FROM  bookings.recurring_payment_schedule rps
         JOIN  bookings.customers c
                 ON c.id = rps.customer_id AND c.tenant_id = rps.tenant_id
         LEFT JOIN bookings.recurring_series rs
                 ON rs.id = rps.recurring_series_id AND rs.tenant_id = rps.tenant_id
         LEFT JOIN bookings.recurring_rules rr
                 ON rr.id = rps.recurring_rule_id
         WHERE rps.tenant_id        = $1::int
           AND rps.migration_source = 'phase3'
           AND rps.status IN ('pending', 'overdue')
         ORDER BY rps.recurring_series_id, rps.due_date ASC`,
        [tenantId]
      );

      return { success: true, data: rows, count: rows.length };
    });
  });


  // ─── POST /recurring/cancel-series ───────────────────────────────────────
  // Cancels an entire recurring series:
  //   1. Deactivates the recurring_rule (active = false)
  //   2. Cancels future confirmed_bookings for this customer
  //   3. Cancels pending/overdue payment_schedule rows
  //   4. Sets customers.status = 'cancelled'
  //   5. Inserts audit_log row with action 'series_cancelled'
  //
  // Body:
  //   series_id    UUID    required  — bookings.recurring_series.id
  //   performed_by string  default 'Staff'
  //
  // Returns: { data: { series_id, customer_id, cancelled_bookings, series_reference } }
  fastify.post('/cancel-series', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['series_id'],
        properties: {
          series_id:    { type: 'string' },
          performed_by: { type: 'string', default: 'Staff' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { series_id, performed_by = 'Staff' } = request.body;
    assertUUID(series_id, 'series_id');

    return withTenantContext(tenantId, async (client) => {
      // 1. Resolve series → customer_id.
      // recurring_series has no rule_id column — join to recurring_rules via rps.recurring_rule_id
      // or fall back to series_name as a human-readable reference.
      const { rows: [series] } = await client.query(
        `SELECT rs.id::text,
                rs.customer_id::text,
                COALESCE(rr.series_reference, rs.series_name, rs.id::text) AS series_reference
         FROM   bookings.recurring_series rs
         LEFT JOIN bookings.recurring_payment_schedule rps
                ON rps.recurring_series_id = rs.id AND rps.recurring_rule_id IS NOT NULL
                AND rps.tenant_id = rs.tenant_id
         LEFT JOIN bookings.recurring_rules rr ON rr.id = rps.recurring_rule_id
         WHERE  rs.id = $1::uuid AND rs.tenant_id = $2::int
         LIMIT  1`,
        [series_id, tenantId]
      );
      if (!series) throw notFound(`recurring_series ${series_id}`);

      // 2. Deactivate the rule
      // recurring_series has no direct rule_id FK — deactivate the series row itself instead.
      await client.query(
        `UPDATE bookings.recurring_series
         SET    active = false
         WHERE  id = $1::uuid AND tenant_id = $2::int`,
        [series_id, tenantId]
      ).catch(() => { /* non-fatal: active column may not exist on all deployments */ });

      // 2b. Refund calculation — must run BEFORE writes so we read live data.
      // refund = total_paid_to_series − value_of_elapsed_cycles_already_delivered
      // "Delivered" = paid cycles whose period_end is in the past (customer has used them).
      // Pattern 3: composite strings in JS; no repeated $N in conflicting type contexts.
      const { rows: [refundRow] } = await client.query(
        `SELECT
           COALESCE(
             (SELECT SUM(p.amount)
              FROM   bookings.payments p
              WHERE  p.recurring_series_id = $1::uuid
                AND  p.tenant_id           = $2::int
                AND  p.status              = 'completed'),
             0
           )::numeric AS total_paid,
           COALESCE(
             (SELECT SUM(rps2.amount_due)
              FROM   bookings.recurring_payment_schedule rps2
              WHERE  rps2.recurring_series_id = $1::uuid
                AND  rps2.tenant_id           = $2::int
                AND  rps2.status              = 'paid'
                AND  rps2.period_end::date    <  CURRENT_DATE),
             0
           )::numeric AS value_delivered`,
        [series_id, tenantId]
      ).catch(() => ({ rows: [{ total_paid: '0', value_delivered: '0' }] }));

      const totalPaid      = parseFloat(refundRow?.total_paid      || 0);
      const valueDelivered = parseFloat(refundRow?.value_delivered || 0);
      const refundAmount   = Math.max(0, totalPaid - valueDelivered);

      await logger.info(
        'RecurringRoute',
        `cancel-series refund calc: total_paid=${totalPaid} value_delivered=${valueDelivered} refund=${refundAmount}`,
        { series_id, total_paid: totalPaid, value_delivered: valueDelivered, refund_amount: refundAmount },
        tenantId
      );

      // 3. Cancel future confirmed_bookings (today and forward only)
      const { rowCount: cancelledBookings } = await client.query(
        `UPDATE bookings.confirmed_bookings
         SET    status = 'cancelled'
         WHERE  customer_id  = $1::uuid
           AND  tenant_id    = $2::int
           AND  booking_date >= CURRENT_DATE
           AND  status NOT IN ('cancelled', 'completed')`,
        [series.customer_id, tenantId]
      );

      // 4. Cancel pending/overdue schedule rows
      await client.query(
        `UPDATE bookings.recurring_payment_schedule
         SET    status     = 'cancelled',
                updated_at = NOW()
         WHERE  recurring_series_id = $1::uuid
           AND  tenant_id           = $2::int
           AND  status IN ('pending', 'overdue')`,
        [series_id, tenantId]
      );

      // 5. Mark customer cancelled — non-fatal (updated_at col may not exist on all schemas)
      await client.query(
        `UPDATE bookings.customers
         SET    status = 'cancelled'
         WHERE  id = $1::uuid AND tenant_id = $2::int`,
        [series.customer_id, tenantId]
      ).catch(() => { /* non-fatal */ });

      // 6. Audit log — Pattern 3: label built in JS
      const seriesRef    = series.series_reference || series_id;
      const auditDetails = `Series ${seriesRef} cancelled by ${performed_by}. Refund due: £${refundAmount.toFixed(2)} (paid £${totalPaid.toFixed(2)}, delivered £${valueDelivered.toFixed(2)})`;
      await client.query(
        `INSERT INTO bookings.audit_logs
           (tenant_id, entity_type, entity_id, action, actor, details, created_at)
         VALUES ($1::integer, 'recurring_series', $2, 'series_cancelled', 'VenueDesk API', $3, NOW())`,
        [tenantId, series_id, auditDetails]
      ).catch(() => { /* non-fatal: audit_logs table may not exist yet */ });

      await logger.info(
        'RecurringRoute',
        `cancel-series: ${series_id} cancelled_bookings=${cancelledBookings}`,
        { series_id, customer_id: series.customer_id, cancelled_bookings: cancelledBookings },
        tenantId
      );

      return {
        success: true,
        data: {
          series_id,
          customer_id:        series.customer_id,
          cancelled_bookings: cancelledBookings,
          series_reference:   series.series_reference || null,
          refund_amount:      parseFloat(refundAmount.toFixed(2)),
          total_paid:         parseFloat(totalPaid.toFixed(2)),
          value_delivered:    parseFloat(valueDelivered.toFixed(2)),
        },
      };
    });
  });


  // ─── POST /recurring/process-overdue ─────────────────────────────────────
  // Marks any pending schedule rows whose due_date has passed as 'overdue'.
  // Called daily by the RecurringPaymentChaser workflow (replaces the
  // "DB: Mark Overdue Payments" Postgres node).
  //
  // Behaviour branches on JWT role:
  //   role: 'service' → withServiceContext, all active tenants in one query
  //   role: other     → withTenantContext,  single tenant from JWT
  //
  // No body required — tenant from JWT (or all tenants for service role).
  //
  // Returns: { data: [{id, series_id, cycle_number, amount_due, due_date, tenant_id}], updated_count }
  fastify.post('/process-overdue', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { isService, tenant_id: tenantId } = request.user;

    if (isService) {
      // Service path — process all active tenants in a single UPDATE.
      // Explicit tenant_id filter via subquery replaces RLS scoping.
      return withServiceContext(async (client) => {
        const { rows, rowCount } = await client.query(
          `UPDATE bookings.recurring_payment_schedule
           SET    status     = 'overdue',
                  updated_at = NOW()
           WHERE  tenant_id IN (
                    SELECT tenant_id FROM bookings.tenants WHERE active = TRUE
                  )
             AND  migration_source = 'phase3'
             AND  status           = 'pending'
             AND  due_date         < CURRENT_DATE
           RETURNING
             id::text,
             tenant_id,
             recurring_series_id::text AS series_id,
             cycle_number,
             amount_due::text,
             due_date::text`
        );

        await logger.info(
          'RecurringRoute',
          `process-overdue [service]: marked ${rowCount} rows overdue across all tenants`,
          { updated_count: rowCount }
        );

        return { success: true, data: rows, updated_count: rowCount };
      });
    }

    // Single-tenant path
    return withTenantContext(tenantId, async (client) => {
      const { rows, rowCount } = await client.query(
        `UPDATE bookings.recurring_payment_schedule
         SET    status     = 'overdue',
                updated_at = NOW()
         WHERE  tenant_id        = $1::int
           AND  migration_source = 'phase3'
           AND  status           = 'pending'
           AND  due_date         < CURRENT_DATE
         RETURNING
           id::text,
           tenant_id,
           recurring_series_id::text AS series_id,
           cycle_number,
           amount_due::text,
           due_date::text`,
        [tenantId]
      );

      await logger.info(
        'RecurringRoute',
        `process-overdue: marked ${rowCount} rows overdue`,
        { updated_count: rowCount },
        tenantId
      );

      return { success: true, data: rows, updated_count: rowCount };
    });
  });


  // ─── GET /recurring/upcoming-reminders ───────────────────────────────────
  // Returns pending schedule rows due within `days_ahead` days (default 3)
  // whose reminder_sent_at is NULL or more than 1 day ago.
  // Joins recurring_rules, customers, rooms for email-ready context.
  // Replaces the "DB: Get Upcoming Reminders" Postgres node in the chaser.
  //
  // Behaviour branches on JWT role:
  //   role: 'service' → withServiceContext, all active tenants in one query
  //   role: other     → withTenantContext,  single tenant from JWT
  //
  // Query params:
  //   days_ahead  int  default 3
  //
  // Returns: { data: [{schedule_id, recurring_rule_id, series_id, cycle_number,
  //                    amount_due, due_date, period_start, period_end,
  //                    payment_timing, frequency, start_time, end_time,
  //                    series_reference, monthly_amount_due,
  //                    customer_id, customer_name, customer_email, customer_phone,
  //                    room_name, tenant_id}], count }
  fastify.get('/upcoming-reminders', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days_ahead: { type: 'integer', default: 3 },
        },
      },
    },
  }, async (request) => {
    const { isService, tenant_id: tenantId } = request.user;
    const daysAhead = parseInt(request.query.days_ahead ?? '3', 10);

    // Shared SELECT body — only the WHERE tenant clause differs between paths
    const buildQuery = (tenantClause) => `
      SELECT
        rps.id::text                  AS schedule_id,
        rps.recurring_rule_id::text,
        rps.recurring_series_id::text AS series_id,
        rps.cycle_number,
        rps.amount_due::text,
        rps.due_date::text,
        rps.period_start::text,
        rps.period_end::text,
        rps.payment_timing,
        rr.frequency,
        rr.start_time::text,
        rr.end_time::text,
        rr.series_reference,
        COALESCE(
          NULLIF(rr.monthly_fee, 0),
          rr.rate_per_session * CASE rr.frequency
            WHEN 'fortnightly' THEN 2
            WHEN 'monthly'     THEN 1
            ELSE 4
          END
        )::text                       AS monthly_amount_due,
        c.id::text                    AS customer_id,
        c.full_name                   AS customer_name,
        c.email                       AS customer_email,
        c.phone                       AS customer_phone,
        rm.name                       AS room_name,
        rps.tenant_id
      FROM  bookings.recurring_payment_schedule rps
      JOIN  bookings.recurring_rules rr ON rr.id = rps.recurring_rule_id
      JOIN  bookings.customers       c  ON c.id  = rr.customer_id
      LEFT JOIN bookings.rooms      rm  ON rm.id = rr.room_id
      WHERE ${tenantClause}
        AND rps.migration_source = 'phase3'
        AND rps.status           = 'pending'
        AND rps.due_date BETWEEN CURRENT_DATE
            AND (CURRENT_DATE + ($1 || ' days')::interval)::date
        AND (rps.reminder_sent_at IS NULL
             OR rps.reminder_sent_at < CURRENT_DATE - INTERVAL '1 day')
        AND c.email IS NOT NULL
        AND c.email != ''
      ORDER BY rps.due_date ASC`;

    if (isService) {
      return withServiceContext(async (client) => {
        const { rows } = await client.query(
          buildQuery(`rps.tenant_id IN (SELECT tenant_id FROM bookings.tenants WHERE active = TRUE)`),
          [String(daysAhead)]
        );
        return { success: true, data: rows, count: rows.length };
      });
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        buildQuery(`rps.tenant_id = $2::int`),
        [String(daysAhead), tenantId]
      );
      return { success: true, data: rows, count: rows.length };
    });
  });


  // ─── POST /recurring/mark-reminder-sent ──────────────────────────────────
  // Sets reminder_sent_at = NOW() on a schedule row after a reminder email
  // has been dispatched. Called by the chaser workflow after Send: Reminder Email.
  // Replaces "DB: Log Reminder Sent" Postgres node.
  //
  // Body:
  //   schedule_id  UUID  required  — bookings.recurring_payment_schedule.id
  //
  // Returns: { data: { id } }
  fastify.post('/mark-reminder-sent', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['schedule_id'],
        properties: {
          schedule_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { schedule_id } = request.body;
    assertUUID(schedule_id, 'schedule_id');

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE bookings.recurring_payment_schedule
         SET    reminder_sent_at = NOW(),
                updated_at       = NOW()
         WHERE  id        = $1::uuid
           AND  tenant_id = $2::int
         RETURNING id::text`,
        [schedule_id, tenantId]
      );
      if (!rows.length) throw notFound(`schedule_id ${schedule_id}`);
      return { success: true, data: rows[0] };
    });
  });


  // ─── GET /recurring/schedule-status ──────────────────────────────────────
  // Returns all lifecycle schedule rows for a given series_id.
  // Used by the frontend (recurring-bookings.html) to derive per-block payment
  // status — replaces the unreliable balance-arithmetic derivation.
  //
  // NOTE: No JWT preHandler — this is a browser GET where CORS prevents custom
  //       headers. tenant_id comes from query param and is used for RLS context.
  //       Read-only endpoint; data is not sensitive for an internal staff tool.
  //
  // Query params:
  //   series_id   UUID  required
  //   tenant_id   int   required
  //
  // Returns: { data: [{schedule_id, cycle_number, period_start, period_end,
  //                    due_date, amount_due, status, reminder_sent_at, updated_at}], count }
  fastify.get('/schedule-status', {
    schema: {
      querystring: {
        type: 'object',
        required: ['series_id', 'tenant_id'],
        properties: {
          series_id: { type: 'string' },
          tenant_id: { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    const tenantId = parseInt(request.query.tenant_id, 10);
    const { series_id } = request.query;
    assertUUID(series_id, 'series_id');

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           id::text           AS schedule_id,
           cycle_number,
           period_start::text,
           period_end::text,
           due_date::text,
           amount_due::text,
           status,
           reminder_sent_at::text,
           updated_at::text
         FROM  bookings.recurring_payment_schedule
         WHERE tenant_id           = $1::int
           AND recurring_series_id = $2::uuid
           AND migration_source    = 'phase3'
         ORDER BY cycle_number ASC`,
        [tenantId, series_id]
      );
      return { success: true, data: rows, count: rows.length };
    });
  });


  // ─── POST /recurring/log-interaction ─────────────────────────────────────
  // CRFC only — inserts a customer_interactions row for recurring contract creation.
  // Mirrors the original DB: Log Interaction node's SQL, with subject + notes
  // built in JS (Pattern 3) rather than string-concatenated in SQL.
  //
  // Body:
  //   customer_id       UUID    required
  //   series_reference  string  default ''
  //   room_name         string  default ''
  //   frequency         string  default 'weekly'
  //   date_count        int     default 0
  //   performed_by      string  default 'Staff'
  //   interaction_type  string  default 'RECURRING_CONTRACT_CREATED'
  //   contract_notes    string  default ''
  //
  // Returns: { data: { id } }
  fastify.post('/log-interaction', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id'],
        properties: {
          customer_id:      { type: 'string' },
          series_reference: { type: 'string', default: '' },
          room_name:        { type: 'string', default: '' },
          frequency:        { type: 'string', default: 'weekly' },
          date_count:       { type: 'integer', default: 0 },
          performed_by:     { type: 'string', default: 'Staff' },
          interaction_type: { type: 'string', default: 'RECURRING_CONTRACT_CREATED' },
          contract_notes:   { type: 'string', default: '' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      series_reference = '',
      room_name        = '',
      frequency        = 'weekly',
      date_count       = 0,
      performed_by     = 'Staff',
      interaction_type = 'RECURRING_CONTRACT_CREATED',
      contract_notes   = '',
    } = request.body;

    assertUUID(customer_id, 'customer_id');

    // Pattern 3 — subject + notes built in JS to avoid $N type conflicts in SQL
    const subject = `Recurring contract created: ${series_reference || 'N/A'}`;
    const notes   = contract_notes ||
      `Action: ${interaction_type}` +
      ` | Series: ${series_reference || 'N/A'}` +
      ` | Room: ${room_name || '—'}` +
      ` | Frequency: ${frequency}` +
      ` | Sessions: ${date_count}` +
      ` | Source: calendar_recurring`;

    return withTenantContext(tenantId, async (client) => {
      const { rows: [interaction] } = await client.query(
        `INSERT INTO bookings.customer_interactions
           (customer_id, subject, interaction_type, notes, timestamp, staff_member, tenant_id)
         VALUES
           ($1::uuid, $2, $3, $4, NOW(), $5, $6::integer)
         RETURNING id::text`,
        [customer_id, subject, interaction_type, notes, performed_by, tenantId]
      );

      return { success: true, data: interaction };
    });
  });

}

module.exports = recurringRoutes;
