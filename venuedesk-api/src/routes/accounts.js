'use strict';

/**
 * /accounts routes — Phase 2 migration.
 * Replaces: bLsB0v8ZyKpvb8pz (VenueDesk - Complete System API) accounts-data
 *           and get-outstanding-bookings Postgres read nodes.
 *
 * All tenant_id values come exclusively from the verified JWT payload.
 * No tenant_id is accepted from the request body (CLAUDE.md §3.3).
 *
 * GET /accounts/metrics      ← DB: Acc Metrics  (revenue totals + outstanding summary)
 * GET /accounts/transactions ← DB: Acc Trans     (payments ledger with LATERAL cycle counts)
 * GET /accounts/outstanding  ← DB: Outstanding   (CTE + UNION ALL — single + recurring)
 */

const { withTenantContext } = require('../db/pool');

async function accountsRoutes(fastify) {

  // ─── GET /accounts/metrics ────────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Acc Metrics
  //
  // Returns aggregate revenue figures and a JSON array of the top 20 outstanding
  // items (single bookings + recurring series contracts).
  fastify.get('/metrics', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows: [metrics] } = await client.query(
        `SELECT
          -- Revenue totals (from payments table — all time)
          (SELECT COALESCE(SUM(amount), 0)
           FROM bookings.payments
           WHERE tenant_id = $1::integer) AS total_revenue,

          (SELECT COALESCE(SUM(amount), 0)
           FROM bookings.payments
           WHERE payment_type = 'deposit'
             AND tenant_id = $1::integer) AS deposits,

          -- Outstanding balance: single sessions + recurring series debt
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
              SELECT SUM(rs.balance_due)
              FROM bookings.recurring_series rs
              WHERE rs.tenant_id  = $1::integer
                AND rs.active     = true
                AND rs.balance_due > 0
            ), 0)
          ) AS outstanding,

          -- Top 20 outstanding items (single bookings + recurring contracts)
          (SELECT JSON_AGG(row ORDER BY row.due_date ASC NULLS LAST) FROM (
            SELECT
              cb.id::text                                          AS item_id,
              c.full_name,
              COALESCE(r.name, 'Single Booking')                   AS item_name,
              cb.balance_due                                       AS amount,
              'single'                                             AS type,
              COALESCE(cb.date_from::date, cb.booking_date::date)  AS due_date,
              NULL::text                                           AS series_reference
            FROM bookings.confirmed_bookings cb
            JOIN bookings.customers c ON cb.customer_id::text = c.id::text
            LEFT JOIN bookings.rooms r ON cb.room_id = r.id
            WHERE cb.tenant_id = $1::integer
              AND cb.status != 'cancelled'
              AND cb.balance_due > 0
              AND cb.recurring_series_id IS NULL
              AND cb.recurring_rule_id   IS NULL

            UNION ALL

            SELECT
              rs.id::text                                          AS item_id,
              c.full_name,
              COALESCE(NULLIF(rs.series_name, ''), 'Block: ' || c.full_name) AS item_name,
              rs.balance_due                                       AS amount,
              'recurring'                                          AS type,
              CURRENT_DATE                                         AS due_date,
              rs.series_name                                       AS series_reference
            FROM bookings.recurring_series rs
            JOIN bookings.customers c ON rs.customer_id::text = c.id::text
            WHERE rs.tenant_id  = $1::integer
              AND rs.active     = true
              AND rs.balance_due > 0

            ORDER BY due_date ASC NULLS LAST
            LIMIT 20
          ) row) AS outstanding_items`,
        [tenantId]
      );

      return { success: true, data: metrics };
    });
  });


  // ─── GET /accounts/transactions ───────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Acc Trans (patched version with LATERAL join)
  //
  // Returns the 200 most recent payment rows for the tenant with booking,
  // room, customer context, and recurring cycle counts (total/paid/pending).
  fastify.get('/transactions', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           p.id               AS payment_id,
           p.payment_date,
           p.created_at       AS payment_created_at,
           p.reference_number,
           p.payment_type,
           p.payment_method,
           p.amount,
           p.status,
           p.booking_id,
           p.series_reference,
           CASE
             WHEN p.series_reference IS NOT NULL THEN 'Recurring: ' || p.series_reference
             WHEN p.booking_id       IS NOT NULL THEN 'Single Booking'
             ELSE NULL
           END AS description,
           CASE
             WHEN p.booking_id IS NULL AND p.series_reference IS NOT NULL THEN true
             ELSE false
           END AS is_recurring,
           COALESCE(c.full_name, cust_direct.full_name, 'Recurring Payment') AS customer_name,
           COALESCE(c.email,     cust_direct.email,     '')                  AS customer_email,
           c.notes,
           COALESCE(
             (SELECT STRING_AGG(DISTINCT r2.name, ', ' ORDER BY r2.name)
              FROM bookings.confirmed_bookings cb2
              JOIN bookings.rooms r2 ON cb2.room_id = r2.id
              WHERE cb2.id = p.booking_id),
             r.name
           ) AS room_name,
           cb.booking_date,
           cb.date_from,
           cb.date_to,
           cb.start_time,
           cb.end_time,
           cb.total_amount,
           cb.balance_due AS booking_balance_due,
           (SELECT dp.reference_number
            FROM bookings.payments dp
            WHERE dp.booking_id    = p.booking_id
              AND dp.payment_type  = 'deposit'
            ORDER BY dp.payment_date ASC LIMIT 1) AS deposit_reference,
           -- Cycle counts for recurring series (X of Y sessions paid)
           -- Only populated for recurring payments (series_reference present, no booking_id)
           cycle_info.total_cycles,
           cycle_info.paid_cycles,
           cycle_info.pending_cycles
         FROM bookings.payments p
         LEFT JOIN bookings.confirmed_bookings cb ON p.booking_id = cb.id
         LEFT JOIN bookings.rooms     r           ON cb.room_id = r.id
         LEFT JOIN bookings.customers c           ON cb.customer_id::text = c.id::text
         LEFT JOIN bookings.customers cust_direct ON p.customer_id::text  = cust_direct.id::text
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*)                                                  AS total_cycles,
             COUNT(*) FILTER (WHERE rps.status IN ('paid','completed')) AS paid_cycles,
             COUNT(*) FILTER (WHERE rps.status = 'pending')            AS pending_cycles
           FROM bookings.recurring_payment_schedule rps
           JOIN bookings.recurring_series rs
                ON rps.recurring_rule_id = rs.id
                AND rps.tenant_id        = rs.tenant_id
           WHERE rs.tenant_id = p.tenant_id
             AND (rs.series_name = p.series_reference
                  OR EXISTS (
                    SELECT 1 FROM bookings.recurring_rules rr
                    WHERE rr.series_reference = p.series_reference
                      AND rr.tenant_id        = rs.tenant_id
                  )
                 )
           LIMIT 1
         ) cycle_info ON (p.booking_id IS NULL AND p.series_reference IS NOT NULL)
         WHERE p.tenant_id = $1::integer
         ORDER BY p.created_at DESC
         LIMIT 200`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });


  // ─── GET /accounts/outstanding ────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Outstanding (get-outstanding-bookings path)
  //
  // CTE + UNION ALL — groups single bookings by customer/date/time slot,
  // then appends recurring series contracts with their next session date.
  // Ordered by event date ASC.
  fastify.get('/outstanding', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `WITH single_bookings AS (
           SELECT
             cb.customer_id,
             COALESCE(cb.date_from, cb.booking_date)            AS event_date,
             cb.start_time,
             cb.end_time,
             MIN(cb.id::text)                                   AS primary_booking_id,
             STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name)  AS room_name,
             MIN(cb.booking_date)   AS booking_date,
             MIN(cb.date_from)      AS date_from,
             MIN(cb.date_to)        AS date_to,
             SUM(cb.total_amount)   AS total_amount,
             SUM(cb.deposit_paid)   AS deposit_paid,
             SUM(cb.balance_due)    AS balance_due,
             MIN(cb.payment_method) AS payment_method,
             MIN(COALESCE(cb.guest_count, 0)) AS guest_count
           FROM bookings.confirmed_bookings cb
           JOIN bookings.rooms r ON cb.room_id = r.id
           WHERE cb.balance_due > 0
             AND cb.recurring_series_id IS NULL
             AND cb.recurring_rule_id   IS NULL
             AND cb.status != 'cancelled'
             AND cb.tenant_id = $1::integer
           GROUP BY cb.customer_id,
                    COALESCE(cb.date_from, cb.booking_date),
                    cb.start_time, cb.end_time
         )

         SELECT
           gb.primary_booking_id   AS booking_id,
           gb.customer_id::text,
           c.full_name,
           c.full_name             AS customer_name,
           c.email,
           c.email                 AS customer_email,
           c.phone,
           c.phone                 AS customer_phone,
           c.notes,
           gb.room_name,
           gb.booking_date,
           gb.date_from,
           gb.date_to,
           gb.start_time::text     AS start_time,
           gb.end_time::text       AS end_time,
           gb.total_amount,
           gb.deposit_paid,
           gb.balance_due,
           gb.payment_method,
           COALESCE(gb.guest_count, c.guests_count) AS guest_count,
           (SELECT p.reference_number
            FROM bookings.payments p
            WHERE p.booking_id::text = gb.primary_booking_id
              AND p.payment_type     = 'deposit'
            ORDER BY p.payment_date ASC LIMIT 1) AS deposit_reference,
           'single'     AS booking_type,
           NULL::text   AS series_reference
         FROM single_bookings gb
         JOIN bookings.customers c ON gb.customer_id = c.id
         WHERE c.tenant_id = $1::integer

         UNION ALL

         SELECT
           rs.id::text             AS booking_id,
           rs.customer_id::text,
           c.full_name,
           c.full_name             AS customer_name,
           c.email,
           c.email                 AS customer_email,
           c.phone,
           c.phone                 AS customer_phone,
           c.notes,
           COALESCE(r.name, 'Contract') AS room_name,
           COALESCE(
             (SELECT MIN(cb2.booking_date)
              FROM bookings.confirmed_bookings cb2
              WHERE cb2.recurring_series_id = rs.id
                AND cb2.tenant_id           = rs.tenant_id
                AND cb2.booking_date        >= CURRENT_DATE
                AND cb2.status              != 'cancelled'),
             rs.start_date
           )                       AS booking_date,
           COALESCE(
             (SELECT MIN(cb2.booking_date)
              FROM bookings.confirmed_bookings cb2
              WHERE cb2.recurring_series_id = rs.id
                AND cb2.tenant_id           = rs.tenant_id
                AND cb2.booking_date        >= CURRENT_DATE
                AND cb2.status              != 'cancelled'),
             rs.start_date
           )                       AS date_from,
           rs.end_date             AS date_to,
           rs.start_time::text     AS start_time,
           rs.end_time::text       AS end_time,
           rs.cycle_amount         AS total_amount,
           0::numeric              AS deposit_paid,
           rs.cycle_amount         AS balance_due,
           'contract'              AS payment_method,
           0                       AS guest_count,
           NULL::text              AS deposit_reference,
           'recurring'             AS booking_type,
           COALESCE(NULLIF(rs.series_name, ''), 'Block: ' || c.full_name) AS series_reference
         FROM bookings.recurring_series rs
         JOIN bookings.customers c ON rs.customer_id::text = c.id::text
         LEFT JOIN bookings.rooms r ON rs.room_id = r.id
         WHERE rs.tenant_id  = $1::integer
           AND rs.active     = true
           AND rs.balance_due > 0

         ORDER BY booking_date ASC`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });

}

module.exports = accountsRoutes;
