'use strict';

/**
 * /dashboard routes — Phase 2 migration.
 * Replaces: bLsB0v8ZyKpvb8pz (VenuePro - Complete System API) Postgres read nodes.
 *
 * All tenant_id values come exclusively from the verified JWT payload.
 * No tenant_id is accepted from the request body (CLAUDE.md §3.3).
 *
 * GET /dashboard/metrics         ← DB: Dash Metrics  (staff-dashboard scorecard)
 * GET /dashboard/recent          ← DB: Recent        (pending/contacted customer list)
 * GET /dashboard/upcoming        ← DB: Upcoming      (next 8 confirmed bookings)
 * GET /dashboard/monthly-revenue ← DB: Monthly Revenue
 */

const { withTenantContext } = require('../db/pool');

async function dashboardRoutes(fastify) {

  // ─── GET /dashboard/metrics ───────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Dash Metrics
  //
  // Returns the four scorecard numbers shown at the top of the staff dashboard:
  //   pending_requests    — customers in 'pending' state with no confirmed booking
  //   contacted_today     — customers marked 'contacted' today
  //   total_revenue_month — sum of payments this calendar month
  //   outstanding         — unpaid balance across single bookings + recurring series
  fastify.get('/metrics', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows: [metrics] } = await client.query(
        `SELECT
          (SELECT COUNT(*)
           FROM bookings.customers c
           WHERE c.status = 'pending'
             AND c.tenant_id = $1::integer
             AND NOT EXISTS (
               SELECT 1 FROM bookings.confirmed_bookings cb
               WHERE cb.customer_id = c.id AND cb.status != 'cancelled'
             )
          ) AS pending_requests,

          (SELECT COUNT(*)
           FROM bookings.customers
           WHERE status = 'contacted'
             AND updated_at >= CURRENT_DATE
             AND tenant_id = $1::integer
          ) AS contacted_today,

          (SELECT COALESCE(SUM(amount), 0)
           FROM bookings.payments
           WHERE date_part('month', payment_date) = date_part('month', CURRENT_DATE)
             AND date_part('year',  payment_date) = date_part('year',  CURRENT_DATE)
             AND tenant_id = $1::integer
             AND amount > 0
          ) AS total_revenue_month,

          (
            COALESCE((
              SELECT SUM(cb.balance_due)
              FROM bookings.confirmed_bookings cb
              WHERE cb.tenant_id = $1::integer
                AND cb.status != 'cancelled'
                AND cb.balance_due > 0
                AND cb.recurring_series_id IS NULL
                AND cb.recurring_rule_id   IS NULL
            ), 0)
            +
            COALESCE((
              SELECT SUM(rs.cycle_amount)
              FROM bookings.recurring_series rs
              WHERE rs.tenant_id = $1::integer
                AND rs.active     = true
                AND rs.balance_due > 0
            ), 0)
          ) AS outstanding`,
        [tenantId]
      );

      return { success: true, data: metrics };
    });
  });


  // ─── GET /dashboard/recent ────────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Recent
  //
  // Returns the 15 most recent pending/contacted customers (excluding those
  // already on an active recurring contract) with their latest booking_request
  // details joined via correlated subqueries.
  fastify.get('/recent', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT c.id, c.full_name, c.email, c.phone, c.event_date,
                c.status, c.created_at,
                COALESCE(
                  (SELECT br.event_type FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  c.event_type
                ) AS event_type,
                COALESCE(
                  (SELECT br.guest_count FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT cb.guest_count FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1),
                  c.guests_count
                ) AS guest_count,
                COALESCE(
                  (SELECT br.notes FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  c.notes
                ) AS notes,
                (SELECT br.id
                 FROM bookings.booking_requests br
                 WHERE br.customer_id = c.id
                   AND br.status NOT IN ('booked', 'cancelled', 'completed')
                 ORDER BY br.created_at DESC LIMIT 1) AS request_id,
                COALESCE(c.warning_sent, false) AS warning_sent,
                CASE WHEN EXISTS(
                  SELECT 1 FROM bookings.confirmed_bookings cb
                  WHERE cb.customer_id = c.id AND cb.status NOT IN ('cancelled', 'pending')
                ) THEN true ELSE false END AS has_booking,
                COALESCE(
                  (SELECT br.requested_date
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT COALESCE(cb.date_from, cb.booking_date)
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS requested_date,
                COALESCE(
                  (SELECT r.name
                   FROM bookings.booking_requests br
                   JOIN bookings.rooms r ON br.room_id = r.id
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT r.name
                   FROM bookings.confirmed_bookings cb
                   JOIN bookings.rooms r ON cb.room_id = r.id
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS room_name,
                COALESCE(
                  (SELECT br.date_from
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT COALESCE(cb.date_from, cb.booking_date)
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS date_from,
                COALESCE(
                  (SELECT br.date_to
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT COALESCE(cb.date_to, cb.booking_date)
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS date_to,
                COALESCE(
                  (SELECT br.start_time
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT cb.start_time
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS start_time,
                COALESCE(
                  (SELECT br.end_time
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT cb.end_time
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS end_time,
                COALESCE(
                  (SELECT br.estimated_cost
                   FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1),
                  (SELECT cb.total_amount
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1)
                ) AS total_amount,
                (SELECT cb.id
                 FROM bookings.confirmed_bookings cb
                 WHERE cb.customer_id = c.id AND cb.status = 'pending'
                 ORDER BY cb.created_at DESC LIMIT 1) AS booking_id
         FROM bookings.customers c
         WHERE c.status IN ('pending', 'contacted')
           AND c.tenant_id = $1::integer
           AND NOT EXISTS (
             SELECT 1 FROM bookings.recurring_series rs
             WHERE rs.customer_id = c.id
               AND rs.tenant_id   = c.tenant_id
               AND rs.active      = true
           )
         ORDER BY CASE WHEN c.status = 'pending' THEN 1 ELSE 2 END, c.created_at DESC
         LIMIT 15`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });


  // ─── GET /dashboard/upcoming ──────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Upcoming
  //
  // Returns the next 8 upcoming single (non-recurring) confirmed bookings.
  fastify.get('/upcoming', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           cb.id,
           cb.booking_date,
           cb.date_from,
           cb.date_to,
           cb.start_time,
           cb.end_time,
           cb.created_at AS booking_created_at,
           c.full_name   AS customer_name,
           c.email       AS customer_email,
           r.name        AS room_name,
           cb.total_amount,
           cb.balance_due,
           cb.payment_method,
           cb.status,
           COALESCE(cb.guest_count, c.guests_count) AS guest_count,
           CASE
             WHEN COALESCE(cb.is_recurring, false) = true THEN true
             WHEN cb.recurring_rule_id IS NOT NULL THEN true
             WHEN EXISTS (
               SELECT 1 FROM bookings.recurring_rules rr
               WHERE rr.customer_id = cb.customer_id
                 AND rr.room_id     = cb.room_id
                 AND rr.tenant_id   = c.tenant_id
                 AND rr.active      = true
             ) THEN true
             ELSE false
           END AS is_recurring,
           cb.recurring_rule_id
         FROM bookings.confirmed_bookings cb
         JOIN bookings.rooms     r ON cb.room_id     = r.id
         JOIN bookings.customers c ON cb.customer_id = c.id
         WHERE COALESCE(cb.date_from, cb.booking_date) >= CURRENT_DATE
           AND cb.status != 'cancelled'
           AND COALESCE(cb.is_recurring, false) = false
           AND cb.recurring_rule_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM bookings.recurring_rules rr
             WHERE rr.customer_id = cb.customer_id
               AND rr.room_id     = cb.room_id
               AND rr.tenant_id   = c.tenant_id
               AND rr.active      = true
           )
           AND c.tenant_id = $1::integer
         ORDER BY COALESCE(cb.date_from, cb.booking_date) ASC
         LIMIT 8`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });


  // ─── GET /dashboard/monthly-revenue ──────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Monthly Revenue
  //
  // Query params:
  //   month  integer  1–12  (defaults to current month)
  //   year   integer        (defaults to current year)
  fastify.get('/monthly-revenue', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          month: { type: 'integer', minimum: 1, maximum: 12 },
          year:  { type: 'integer', minimum: 2000 },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const now      = new Date();
    const month    = request.query.month ?? (now.getMonth() + 1);
    const year     = request.query.year  ?? now.getFullYear();

    return withTenantContext(tenantId, async (client) => {
      const { rows: [result] } = await client.query(
        `SELECT
           COALESCE(SUM(p.amount), 0) AS total_revenue,
           $1::int AS month,
           $2::int AS year
         FROM bookings.payments p
         WHERE date_part('month', p.payment_date) = $1
           AND date_part('year',  p.payment_date) = $2
           AND p.tenant_id = $3::integer
           AND p.amount > 0`,
        [month, year, tenantId]
      );

      return { success: true, data: result };
    });
  });


  // ─── GET /dashboard/all ───────────────────────────────────────────────────
  // Combined endpoint: runs metrics, recent, upcoming, and outstanding queries
  // in parallel via Promise.all, returning a single response.
  // Replaces 4 sequential HTTP calls in the n8n staff-dashboard workflow,
  // reducing dashboard load time from ~14s to ~2-3s.
  fastify.get('/all', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const [metrics, recentRows, upcomingRows, outstandingRows] = await Promise.all([

      withTenantContext(tenantId, async (client) => {
        const { rows: [row] } = await client.query(
          `SELECT
            (SELECT COUNT(*)
             FROM bookings.customers c
             WHERE c.status = 'pending'
               AND c.tenant_id = $1::integer
               AND NOT EXISTS (
                 SELECT 1 FROM bookings.confirmed_bookings cb
                 WHERE cb.customer_id = c.id AND cb.status != 'cancelled'
               )
            ) AS pending_requests,
            (SELECT COUNT(*)
             FROM bookings.customers
             WHERE status = 'contacted'
               AND updated_at >= CURRENT_DATE
               AND tenant_id = $1::integer
            ) AS contacted_today,
            (SELECT COALESCE(SUM(amount), 0)
             FROM bookings.payments
             WHERE date_part('month', payment_date) = date_part('month', CURRENT_DATE)
               AND date_part('year',  payment_date) = date_part('year',  CURRENT_DATE)
               AND tenant_id = $1::integer
               AND amount > 0
            ) AS total_revenue_month,
            (
              COALESCE((
                SELECT SUM(cb.balance_due)
                FROM bookings.confirmed_bookings cb
                WHERE cb.tenant_id = $1::integer
                  AND cb.status != 'cancelled'
                  AND cb.balance_due > 0
                  AND cb.recurring_series_id IS NULL
                  AND cb.recurring_rule_id   IS NULL
              ), 0)
              +
              COALESCE((
                SELECT SUM(rs.cycle_amount)
                FROM bookings.recurring_series rs
                WHERE rs.tenant_id = $1::integer
                  AND rs.active     = true
                  AND rs.balance_due > 0
              ), 0)
            ) AS outstanding`,
          [tenantId]
        );
        return row;
      }),

      withTenantContext(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT c.id, c.full_name, c.email, c.phone, c.event_date,
                  c.status, c.created_at,
                  COALESCE(
                    (SELECT br.event_type FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    c.event_type
                  ) AS event_type,
                  COALESCE(
                    (SELECT br.guest_count FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT cb.guest_count FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1),
                    c.guests_count
                  ) AS guest_count,
                  COALESCE(
                    (SELECT br.notes FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    c.notes
                  ) AS notes,
                  (SELECT br.id FROM bookings.booking_requests br
                   WHERE br.customer_id = c.id
                     AND br.status NOT IN ('booked', 'cancelled', 'completed')
                   ORDER BY br.created_at DESC LIMIT 1) AS request_id,
                  COALESCE(c.warning_sent, false) AS warning_sent,
                  CASE WHEN EXISTS(
                    SELECT 1 FROM bookings.confirmed_bookings cb
                    WHERE cb.customer_id = c.id AND cb.status NOT IN ('cancelled', 'pending')
                  ) THEN true ELSE false END AS has_booking,
                  COALESCE(
                    (SELECT br.requested_date FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT COALESCE(cb.date_from, cb.booking_date)
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS requested_date,
                  COALESCE(
                    (SELECT r.name FROM bookings.booking_requests br
                     JOIN bookings.rooms r ON br.room_id = r.id
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT r.name
                     FROM bookings.confirmed_bookings cb
                     JOIN bookings.rooms r ON cb.room_id = r.id
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS room_name,
                  COALESCE(
                    (SELECT br.date_from FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT COALESCE(cb.date_from, cb.booking_date)
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS date_from,
                  COALESCE(
                    (SELECT br.date_to FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT COALESCE(cb.date_to, cb.booking_date)
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS date_to,
                  COALESCE(
                    (SELECT br.start_time FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT cb.start_time
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS start_time,
                  COALESCE(
                    (SELECT br.end_time FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT cb.end_time
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS end_time,
                  COALESCE(
                    (SELECT br.estimated_cost FROM bookings.booking_requests br
                     WHERE br.customer_id = c.id
                       AND br.status NOT IN ('booked', 'cancelled', 'completed')
                     ORDER BY br.created_at DESC LIMIT 1),
                    (SELECT cb.total_amount
                     FROM bookings.confirmed_bookings cb
                     WHERE cb.customer_id = c.id AND cb.status = 'pending'
                     ORDER BY cb.created_at DESC LIMIT 1)
                  ) AS total_amount,
                  (SELECT cb.id
                   FROM bookings.confirmed_bookings cb
                   WHERE cb.customer_id = c.id AND cb.status = 'pending'
                   ORDER BY cb.created_at DESC LIMIT 1) AS booking_id
           FROM bookings.customers c
           WHERE c.status IN ('pending', 'contacted')
             AND c.tenant_id = $1::integer
             AND NOT EXISTS (
               SELECT 1 FROM bookings.recurring_series rs
               WHERE rs.customer_id = c.id
                 AND rs.tenant_id   = c.tenant_id
                 AND rs.active      = true
             )
           ORDER BY CASE WHEN c.status = 'pending' THEN 1 ELSE 2 END, c.created_at DESC
           LIMIT 15`,
          [tenantId]
        );
        return rows;
      }),

      withTenantContext(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT cb.id, cb.booking_date, cb.date_from, cb.date_to,
                  cb.start_time, cb.end_time,
                  cb.created_at AS booking_created_at,
                  c.full_name   AS customer_name,
                  c.email       AS customer_email,
                  r.name        AS room_name,
                  cb.total_amount, cb.balance_due, cb.payment_method, cb.status,
                  COALESCE(cb.guest_count, c.guests_count) AS guest_count,
                  CASE
                    WHEN COALESCE(cb.is_recurring, false) = true THEN true
                    WHEN cb.recurring_rule_id IS NOT NULL THEN true
                    WHEN EXISTS (
                      SELECT 1 FROM bookings.recurring_rules rr
                      WHERE rr.customer_id = cb.customer_id
                        AND rr.room_id     = cb.room_id
                        AND rr.tenant_id   = c.tenant_id
                        AND rr.active      = true
                    ) THEN true
                    ELSE false
                  END AS is_recurring,
                  cb.recurring_rule_id
           FROM bookings.confirmed_bookings cb
           JOIN bookings.rooms     r ON cb.room_id     = r.id
           JOIN bookings.customers c ON cb.customer_id = c.id
           WHERE COALESCE(cb.date_from, cb.booking_date) >= CURRENT_DATE
             AND cb.status != 'cancelled'
             AND COALESCE(cb.is_recurring, false) = false
             AND cb.recurring_rule_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM bookings.recurring_rules rr
               WHERE rr.customer_id = cb.customer_id
                 AND rr.room_id     = cb.room_id
                 AND rr.tenant_id   = c.tenant_id
                 AND rr.active      = true
             )
             AND c.tenant_id = $1::integer
           ORDER BY COALESCE(cb.date_from, cb.booking_date) ASC
           LIMIT 8`,
          [tenantId]
        );
        return rows;
      }),

      withTenantContext(tenantId, async (client) => {
        const { rows } = await client.query(
          `WITH single_bookings AS (
             SELECT
               cb.customer_id,
               COALESCE(cb.date_from, cb.booking_date)            AS event_date,
               cb.start_time, cb.end_time,
               MIN(cb.id::text)                                   AS primary_booking_id,
               STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name)  AS room_name,
               MIN(cb.booking_date) AS booking_date,
               MIN(cb.date_from)    AS date_from,
               MIN(cb.date_to)      AS date_to,
               SUM(cb.total_amount) AS total_amount,
               SUM(cb.deposit_paid) AS deposit_paid,
               SUM(cb.balance_due)  AS balance_due,
               MIN(cb.payment_method) AS payment_method,
               MIN(COALESCE(cb.guest_count, 0)) AS guest_count
             FROM bookings.confirmed_bookings cb
             JOIN bookings.rooms r ON cb.room_id = r.id
             WHERE cb.balance_due > 0
               AND cb.recurring_series_id IS NULL
               AND cb.recurring_rule_id   IS NULL
               AND cb.status != 'cancelled'
               AND cb.tenant_id = $1::integer
             GROUP BY cb.customer_id, COALESCE(cb.date_from, cb.booking_date), cb.start_time, cb.end_time
           )
           SELECT
             gb.primary_booking_id AS booking_id, gb.customer_id::text,
             c.full_name, c.full_name AS customer_name,
             c.email, c.email AS customer_email,
             c.phone, c.phone AS customer_phone, c.notes,
             gb.room_name, gb.booking_date, gb.date_from, gb.date_to,
             gb.start_time::text AS start_time, gb.end_time::text AS end_time,
             gb.total_amount, gb.deposit_paid, gb.balance_due, gb.payment_method,
             COALESCE(gb.guest_count, c.guests_count) AS guest_count,
             (SELECT p.reference_number FROM bookings.payments p
              WHERE p.booking_id::text = gb.primary_booking_id
                AND p.payment_type = 'deposit'
              ORDER BY p.payment_date ASC LIMIT 1) AS deposit_reference,
             'single' AS booking_type, NULL::text AS series_reference
           FROM single_bookings gb
           JOIN bookings.customers c ON gb.customer_id = c.id
           WHERE c.tenant_id = $1::integer

           UNION ALL

           SELECT
             rs.id::text AS booking_id, rs.customer_id::text,
             c.full_name, c.full_name AS customer_name,
             c.email, c.email AS customer_email,
             c.phone, c.phone AS customer_phone, c.notes,
             COALESCE(r.name, 'Contract') AS room_name,
             COALESCE(
               (SELECT MIN(cb2.booking_date) FROM bookings.confirmed_bookings cb2
                WHERE cb2.recurring_series_id = rs.id AND cb2.tenant_id = rs.tenant_id
                  AND cb2.booking_date >= CURRENT_DATE AND cb2.status != 'cancelled'),
               rs.start_date
             ) AS booking_date,
             COALESCE(
               (SELECT MIN(cb2.booking_date) FROM bookings.confirmed_bookings cb2
                WHERE cb2.recurring_series_id = rs.id AND cb2.tenant_id = rs.tenant_id
                  AND cb2.booking_date >= CURRENT_DATE AND cb2.status != 'cancelled'),
               rs.start_date
             ) AS date_from,
             rs.end_date AS date_to,
             rs.start_time::text AS start_time, rs.end_time::text AS end_time,
             rs.cycle_amount AS total_amount, 0::numeric AS deposit_paid,
             rs.cycle_amount AS balance_due, 'contract' AS payment_method,
             0 AS guest_count, NULL::text AS deposit_reference,
             'recurring' AS booking_type,
             COALESCE(NULLIF(rs.series_name, ''), 'Block: ' || c.full_name) AS series_reference
           FROM bookings.recurring_series rs
           JOIN bookings.customers c ON rs.customer_id::text = c.id::text
           LEFT JOIN bookings.rooms r ON rs.room_id = r.id
           WHERE rs.tenant_id = $1::integer AND rs.active = true AND rs.balance_due > 0

           ORDER BY booking_date ASC`,
          [tenantId]
        );
        return rows;
      }),

    ]);

    return {
      success: true,
      data: {
        metrics: {
          total_revenue_month: metrics.total_revenue_month || 0,
          outstanding:         metrics.outstanding         || 0,
          pending_requests:    metrics.pending_requests    || 0,
          contacted_today:     metrics.contacted_today     || 0,
        },
        recent_customers:  recentRows,
        upcoming_bookings: upcomingRows,
        outstanding:       outstandingRows,
      },
    };
  });

}

module.exports = dashboardRoutes;
