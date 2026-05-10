'use strict';

/**
 * /payments routes — Phase 2 migration.
 * Replaces n8n Postgres nodes for payment recording across all booking types.
 *
 * Workflows replaced:
 *   POST /payments/record  ← KHvxUBua7hi5e1x1 (RecordPayment — single bookings)
 *                            RecordRecurringPayment (recurring series)
 *                            BillingCycleTrigger (automated billing cycle recording)
 *
 * Payment routing logic (CLAUDE.md parent-child model):
 *   - booking_id supplied   → single booking or child recurring session
 *   - series_id supplied    → directly reduces recurring_series.balance_due
 *   If booking has recurring_series_id, debt is applied to the PARENT series, not the child row.
 *
 * tenant_id from JWT only. Never from request body.
 */

const { withTenantContext, systemQuery } = require('../db/pool');
const logger                             = require('../services/LoggerService');
const { notFound, unprocessable }        = require('../utils/errors');
const { assertUUID, assertNumber }       = require('../utils/validators');

async function paymentsRoutes(fastify) {

  // ─── POST /payments/record ─────────────────────────────────────────────────
  // Records a payment against a booking or recurring series.
  // Handles:
  //   A. Single confirmed_bookings (no recurring_series_id) — updates booking balance
  //   B. Recurring child session (has recurring_series_id)  — routes debt to parent series
  //   C. Recurring series directly (series_id only)         — reduces series.balance_due
  //
  // Body:
  //   amount          number  required  — amount paid (positive)
  //   payment_method  string  required  — 'cash' | 'bank_transfer' | 'card' | 'cheque' etc
  //   booking_id      UUID    optional  — mode A or B
  //   series_id       UUID    optional  — mode C
  //   payment_type    string  default 'payment'
  //   reference       string  optional  — external payment reference
  //   notes           string  optional
  //   apply_to_sessions int   default 0 — (recurring only) mark N oldest sessions fully_paid
  fastify.post('/record', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'payment_method'],
        properties: {
          booking_id:        { type: 'string'  },
          series_id:         { type: 'string'  },
          amount:            { type: 'number'  },
          payment_method:    { type: 'string'  },
          payment_type:      { type: 'string', default: 'payment' },
          reference:         { type: 'string', default: ''        },
          notes:             { type: 'string', default: ''        },
          apply_to_sessions: { type: 'integer', default: 0       },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      booking_id,
      series_id,
      amount,
      payment_method,
      payment_type      = 'payment',
      reference         = '',
      notes             = '',
      apply_to_sessions = 0,
    } = request.body;

    if (!booking_id && !series_id) {
      throw unprocessable('Either booking_id or series_id is required');
    }
    if (amount <= 0) {
      throw unprocessable('amount must be a positive number');
    }

    if (booking_id) assertUUID(booking_id, 'booking_id');
    if (series_id)  assertUUID(series_id,  'series_id');

    return withTenantContext(tenantId, async (client) => {

      // ── Resolve target: booking → check for parent series ────────────────
      let resolvedSeriesId = series_id ?? null;
      let resolvedBookingId = booking_id ?? null;
      let customerId = null;
      let seriesReference = null;
      let newBalance = null;

      // Email context — populated from booking + customer lookup below
      let emailCtx = {
        customer_email: null, customer_name: null,
        room_name: null, event_date: null,
        start_time: null, end_time: null, total_amount: null,
      };

      if (booking_id) {
        // Load booking — determine if it's a child of a recurring series.
        // Expanded with room + customer JOINs so the payment response contains
        // all data needed for the confirmation email (avoids a second GET call in n8n).
        const { rows: [booking] } = await client.query(
          `SELECT cb.id, cb.customer_id, cb.recurring_series_id, cb.total_amount,
                  cb.balance_due, cb.deposit_paid,
                  cb.date_from, cb.booking_date, cb.start_time, cb.end_time,
                  r.name         AS room_name,
                  c.full_name    AS customer_name,
                  c.email        AS customer_email,
                  COALESCE(rs.series_name, 'Contract') AS series_name
           FROM   bookings.confirmed_bookings cb
           LEFT JOIN bookings.recurring_series rs
                  ON rs.id = cb.recurring_series_id
           LEFT JOIN bookings.rooms r
                  ON r.id = cb.room_id
           LEFT JOIN bookings.customers c
                  ON c.id::text = cb.customer_id::text
           WHERE  cb.id = $1::uuid AND cb.tenant_id = $2
           LIMIT  1`,
          [booking_id, tenantId]
        );

        if (!booking) throw notFound('Booking', booking_id);

        customerId = booking.customer_id;
        seriesReference = booking.series_name;

        emailCtx = {
          customer_email: booking.customer_email ?? null,
          customer_name:  booking.customer_name  ?? null,
          room_name:      booking.room_name       ?? null,
          event_date:     booking.date_from       ?? booking.booking_date ?? null,
          start_time:     booking.start_time      ?? null,
          end_time:       booking.end_time        ?? null,
          total_amount:   booking.total_amount    ?? null,
        };

        if (booking.recurring_series_id) {
          // Mode B: child session → route payment to parent series
          resolvedSeriesId  = booking.recurring_series_id;
          resolvedBookingId = null; // don't touch the child balance_due (trigger enforces 0)
        }
      }

      // ── Apply balance reduction ───────────────────────────────────────────
      if (resolvedSeriesId) {
        // Mode B or C: reduce recurring_series.balance_due
        // Mirrors DB: Mark Period Paid (Step A) in RecordRecurringPayment
        const { rows: [seriesRow] } = await client.query(
          `UPDATE bookings.recurring_series
           SET    balance_due = GREATEST(0, balance_due - $1::numeric),
                  updated_at  = NOW()
           WHERE  id          = $2::uuid
             AND  tenant_id   = $3::integer
           RETURNING balance_due, customer_id, series_name`,
          [amount, resolvedSeriesId, tenantId]
        );

        if (!seriesRow) throw notFound('RecurringSeries', resolvedSeriesId);

        customerId      = customerId      ?? seriesRow.customer_id;
        seriesReference = seriesReference ?? seriesRow.series_name;
        newBalance      = seriesRow.balance_due;

        // Mode C (series-only): fetch customer details for email since no booking was loaded
        if (!booking_id && customerId) {
          const { rows: [cust] } = await client.query(
            `SELECT full_name, email FROM bookings.customers
             WHERE  id = $1 AND tenant_id = $2 LIMIT 1`,
            [customerId, tenantId]
          );
          emailCtx.customer_email = cust?.email    ?? null;
          emailCtx.customer_name  = cust?.full_name ?? null;
        }

        // Mark N oldest unpaid child sessions fully_paid (optional distribution)
        // Mirrors DB: Apply to Sessions in RecordRecurringPayment
        if (apply_to_sessions > 0) {
          await client.query(
            `WITH sessions_to_mark AS (
               SELECT id
               FROM   bookings.confirmed_bookings
               WHERE  (recurring_series_id = $1::uuid OR recurring_rule_id = $1::uuid)
                 AND  tenant_id = $2::integer
                 AND  status   NOT IN ('cancelled', 'fully_paid')
               ORDER  BY COALESCE(date_from, booking_date) ASC
               LIMIT  $3
             )
             UPDATE bookings.confirmed_bookings cb
             SET    balance_due  = 0,
                    deposit_paid = cb.total_amount,
                    status       = 'fully_paid',
                    updated_at   = NOW()
             FROM   sessions_to_mark stm
             WHERE  cb.id        = stm.id
               AND  cb.tenant_id = $2::integer`,
            [resolvedSeriesId, tenantId, apply_to_sessions]
          );
        }

      } else {
        // Mode A: standalone booking — reduce balance on confirmed_bookings
        // Mirrors KHvxUBua7hi5e1x1 → DB: Update Balance (booking_update CTE)
        const { rows: [bkRow] } = await client.query(
          `UPDATE bookings.confirmed_bookings
           SET    balance_due  = GREATEST(0, balance_due - $1::numeric),
                  deposit_paid = deposit_paid + $1::numeric,
                  updated_at   = NOW()
           WHERE  id          = $2::uuid
             AND  tenant_id   = $3::integer
           RETURNING balance_due, total_amount, customer_id`,
          [amount, resolvedBookingId, tenantId]
        );

        if (!bkRow) throw notFound('Booking', resolvedBookingId);

        customerId = bkRow.customer_id;
        newBalance = bkRow.balance_due;

        // Mark fully paid when balance reaches zero
        // Mirrors KHvxUBua7hi5e1x1 → DB: Mark Paid
        if (bkRow.balance_due === 0) {
          await client.query(
            `UPDATE bookings.confirmed_bookings
             SET    status = 'fully_paid'
             WHERE  id = $1::uuid AND tenant_id = $2`,
            [resolvedBookingId, tenantId]
          );
        }
      }

      // ── Insert payments row ───────────────────────────────────────────────
      // Mirrors DB: Record Payment Entry (RecordRecurringPayment)
      const ref = reference
        || `PAY-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const { rows: [payment] } = await client.query(
        `INSERT INTO bookings.payments
           (booking_id, customer_id, payment_type, amount, payment_method,
            status, reference_number, series_reference, tenant_id, payment_date)
         VALUES
           ($1, $2::uuid, $3, $4::numeric, $5,
            'completed', $6, $7, $8::integer, NOW())
         RETURNING id, reference_number, amount, payment_method`,
        [
          resolvedBookingId ?? null,
          customerId,
          payment_type === 'deposit' ? 'deposit' : (resolvedSeriesId ? 'recurring_payment' : 'balance'),
          amount,
          payment_method,
          ref,
          seriesReference ?? null,
          tenantId,
        ]
      );

      // ── Write CLAUDE.md §2.7 audit log ───────────────────────────────────
      // Mirrors DB: Write Audit Log in RecordRecurringPayment
      await client.query(
        `INSERT INTO bookings.audit_logs
           (tenant_id, action, entity, entity_id, payload, performed_by, created_at)
         VALUES ($1, 'PAYMENT', $2, $3,
                 jsonb_build_object(
                   'amount',         $4::numeric,
                   'payment_method', $5::text,
                   'reference',      $6::text,
                   'payment_id',     $7::text,
                   'booking_id',     $8::text,
                   'series_id',      $9::text
                 ),
                 $10, NOW())`,
        [
          tenantId,
          resolvedSeriesId ? 'recurring_series' : 'booking',
          resolvedSeriesId ?? resolvedBookingId,
          amount,
          payment_method,
          ref,
          payment.id,
          booking_id   ?? null,
          resolvedSeriesId ?? null,
          request.user.user_id,
        ]
      );

      // ── Log customer interaction ──────────────────────────────────────────
      // Mirrors DB: Log Payment Interaction in KHvxUBua7hi5e1x1
      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, booking_id,
            subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2, $3,
                 'Payment received: £' || $4::text,
                 'payment_received',
                 $5,
                 'VenueDesk API', NOW())`,
        [
          tenantId,
          customerId,
          resolvedBookingId ?? null,
          amount,
          `Method: ${payment_method} | Ref: ${ref}${notes ? ` | ${notes}` : ''}`,
        ]
      );

      await logger.info(
        'PaymentsRoute',
        `Payment recorded: £${amount} — ${ref}`,
        {
          payment_id:  payment.id,
          booking_id:  booking_id   ?? null,
          series_id:   resolvedSeriesId ?? null,
          amount,
          new_balance: newBalance,
          tenant_id:   tenantId,
        },
        tenantId
      );

      return {
        success: true,
        data: {
          payment_id:       payment.id,
          reference_number: payment.reference_number,
          amount:           payment.amount,
          payment_method:   payment.payment_method,
          new_balance:      newBalance,
          balance_due:      newBalance,
          booking_id:       booking_id       ?? null,
          series_id:        resolvedSeriesId ?? null,
          // Email context — allows n8n to send confirmation without a second GET
          customer_email:   emailCtx.customer_email,
          customer_name:    emailCtx.customer_name,
          room_name:        emailCtx.room_name,
          event_date:       emailCtx.event_date,
          start_time:       emailCtx.start_time,
          end_time:         emailCtx.end_time,
          total_amount:     emailCtx.total_amount,
        },
      };
    });
  });

}

module.exports = paymentsRoutes;
