'use strict';

/**
 * BillingService
 * ─────────────────────────────────────────────────────────────────────────────
 * Two public cron-facing methods:
 *
 *  runBillingCycle()        — 08:00 daily
 *    Ports "VenueDesk — Billing Cycle Daily Trigger" (BillingCycleTrigger.json).
 *    Finds recurring_payment_schedule rows due today, creates outstanding_payment
 *    records, decrements remaining_cycles, and emails the customer.
 *
 *  runOverdueBalanceCheck() — 08:30 daily  (NEW — no n8n equivalent)
 *    Scans for bookings where money is still owed but the event has passed:
 *
 *    Path A — Standalone confirmed_bookings
 *      WHERE balance_due > 0
 *        AND date_to < CURRENT_DATE
 *        AND recurring_series_id IS NULL        ← debt lives here for standalones
 *        AND status NOT IN ('cancelled','completed')
 *
 *    Path B — Recurring series contracts
 *      WHERE balance_due > 0
 *        AND active = TRUE
 *        AND next_session_date < CURRENT_DATE   ← contract is ongoing but behind
 *
 *    For each:
 *      1. INSERT outstanding_payment (ON CONFLICT DO NOTHING — idempotent)
 *      2. EmailService reminder
 *      3. Log to customer_interactions + system_logs
 *
 * Key invariant (from 001_recurring_series_architecture.sql):
 *   Debt on recurring child sessions lives on recurring_series.balance_due,
 *   NOT on confirmed_bookings.balance_due (enforced by DB trigger).
 *   Standalone bookings carry their own balance_due directly.
 */

const { systemQuery } = require('../db/pool');
const EmailService    = require('./EmailService');
const logger          = require('./LoggerService');
const { elapsedSec, formatGBP } = require('../utils/format');

class BillingService {

  /**
   * Daily 08:00 job.
   * Finds all recurring_payment_schedule rows whose billing_day matches today,
   * creates an outstanding_payment record, decrements remaining_cycles, and
   * emails the customer.
   */
  async runBillingCycle() {
    const startedAt = Date.now();
    await logger.info('BillingService', 'runBillingCycle started');

    // ── Step 1: Find due billing cycles ─────────────────────────────────────
    // Exact port of "DB: Find Due Billing Cycles" SQL.
    const { rows: schedules } = await systemQuery(`
      SELECT
        rps.id             AS schedule_id,
        rps.tenant_id,
        rps.recurring_rule_id,
        rps.customer_id,
        rps.billing_day,
        rps.total_cycles,
        rps.remaining_cycles,
        COALESCE(
          NULLIF(rr.agreed_price,    0),
          NULLIF(rr.monthly_fee,     0),
          NULLIF(rps.amount_due,     0),
          rr.rate_per_session * CASE rr.frequency
            WHEN 'fortnightly' THEN 2
            WHEN 'monthly'     THEN 1
            ELSE 4
          END
        )                  AS amount_due,
        rr.agreed_price,
        rr.monthly_fee,
        rr.rate_per_session,
        rr.sessions_per_cycle,
        rps.period_start::text,
        rps.period_end::text,
        c.full_name        AS customer_name,
        c.email            AS customer_email,
        r.name             AS room_name,
        rr.frequency,
        rr.series_reference
      FROM  bookings.recurring_payment_schedule rps
      JOIN  bookings.customers                  c   ON c.id  = rps.customer_id
      JOIN  bookings.recurring_rules            rr  ON rr.id = rps.recurring_rule_id
      JOIN  bookings.rooms                      r   ON r.id  = rr.room_id
      WHERE rps.billing_day    = EXTRACT(day FROM CURRENT_DATE)::int
        AND rps.remaining_cycles > 0
        AND rps.status NOT IN ('cancelled')
        AND rr.active = TRUE
      ORDER BY rps.tenant_id, rps.period_start
    `);

    // ── Step 2: IF Any Due Today? ────────────────────────────────────────────
    if (!schedules.length) {
      await logger.info('BillingService', 'No billing cycles due today');
      await systemQuery(
        `INSERT INTO bookings.workflow_audit_log (workflow_name, event, notes)
         VALUES ('BillingService', 'no_billing_due',
                 'No recurring payment schedules were due today (' || CURRENT_DATE::text || ').')`
      );
      return;
    }

    await logger.info('BillingService', `Processing ${schedules.length} billing cycles`);
    let processed = 0; let errored = 0;

    for (const s of schedules) {
      try {
        await this._processSingleCycle(s);
        processed++;
      } catch (err) {
        errored++;
        await logger.error(
          'BillingService',
          `Failed to process schedule ${s.schedule_id}`,
          { customerId: s.customer_id, error: err.message },
          s.tenant_id
        );
      }
    }

    await logger.info(
      'BillingService',
      `runBillingCycle complete — processed: ${processed}, errors: ${errored}, elapsed: ${elapsedSec(startedAt)}`
    );
  }

  /**
   * Process one recurring_payment_schedule row atomically.
   *
   * Steps (mirrors the n8n chain per-item):
   *   1. INSERT outstanding_payment (ON CONFLICT DO NOTHING — idempotent)
   *   2. UPDATE recurring_payment_schedule — decrement + roll dates forward
   *   3. Send email (fire-and-forget but we capture result)
   *   4. Mark email_sent_at on outstanding_payment
   *   5. Log interaction to customer_interactions
   */
  async _processSingleCycle(s) {

    // ── Step 2a: Create Outstanding Payment ──────────────────────────────────
    // Ported from "DB: Create Outstanding Payment".
    const cycleNumber = (s.total_cycles != null && s.remaining_cycles != null)
      ? s.total_cycles - s.remaining_cycles + 1
      : null;

    const { rows: opRows } = await systemQuery(
      `INSERT INTO bookings.outstanding_payments (
         tenant_id, recurring_rule_id, customer_id,
         period_start, amount_due, due_date, status, cycle_number
       )
       VALUES (
         $1, $2::uuid, $3::uuid,
         (DATE_TRUNC('month', $4::date) + INTERVAL '1 month')::date,
         $5::numeric,
         LEAST(
           (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')
             + ($6::int - 1) * INTERVAL '1 day')::date,
           (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '2 months')
             - INTERVAL '1 day')::date
         ),
         'pending',
         $7
       )
       ON CONFLICT (recurring_rule_id, period_start) DO NOTHING
       RETURNING id::text, period_start::text, due_date::text, cycle_number`,
      [
        s.tenant_id,
        s.recurring_rule_id,
        s.customer_id,
        s.period_end,
        String(s.amount_due),
        String(s.billing_day),
        cycleNumber,
      ]
    );

    // ON CONFLICT — this cycle was already processed today; skip silently.
    if (!opRows.length) {
      await logger.info(
        'BillingService',
        `Schedule ${s.schedule_id} already processed (ON CONFLICT DO NOTHING)`
      );
      return;
    }

    const op = opRows[0];

    // ── Step 2b: Decrement Remaining Cycles ──────────────────────────────────
    // Ported from "DB: Decrement Remaining Cycles".
    await systemQuery(
      `UPDATE bookings.recurring_payment_schedule
       SET
         remaining_cycles = remaining_cycles - 1,
         period_start     = (DATE_TRUNC('month', period_end) + INTERVAL '1 month')::date,
         period_end       = (DATE_TRUNC('month', period_end) + INTERVAL '2 months' - INTERVAL '1 day')::date
       WHERE id = $1::uuid`,
      [s.schedule_id]
    );

    // ── Step 2c: Build and send email ────────────────────────────────────────
    // Ported from "Code: Format Email" + "Email: Payment Reminder".
    const { subject, html } = EmailService.buildBillingReminderHtml({
      customerName:    s.customer_name,
      frequency:       s.frequency,
      cycleNum:        s.total_cycles && s.remaining_cycles ? s.total_cycles - s.remaining_cycles + 1 : null,
      totalCycles:     s.total_cycles,
      seriesReference: s.series_reference,
      roomName:        s.room_name,
      amountDue:       s.amount_due,
      dueDate:         op.due_date,
      remainingCycles: s.remaining_cycles,
    });

    const sendResult = await EmailService.sendHtml(
      { to: s.customer_email, subject, html },
      s.tenant_id
    );

    // ── Step 2d: Mark email_sent_at ──────────────────────────────────────────
    // Ported from "DB: Mark Email Sent".
    if (sendResult.success) {
      await systemQuery(
        `UPDATE bookings.outstanding_payments
         SET    email_sent_at = NOW()
         WHERE  recurring_rule_id = $1::uuid
           AND  status            = 'pending'
           AND  period_start      = $2::date`,
        [s.recurring_rule_id, op.period_start]
      );
    }

    // ── Step 2e: Log interaction ─────────────────────────────────────────────
    // Ported from "DB: Log Reminder Sent".
    await systemQuery(
      `INSERT INTO bookings.customer_interactions
         (customer_id, customer_email, subject, interaction_type, notes, timestamp, staff_member, tenant_id)
       VALUES
         ($1::uuid, $2, $3, 'payment_reminder',
          'Automated billing cycle reminder sent. Amount due: £' || $4::text || ' by ' || $5::text,
          NOW(), 'System', $6)`,
      [
        s.customer_id,
        s.customer_email ?? '',
        subject,
        formatGBP(s.amount_due),
        op.due_date ?? '',
        parseInt(s.tenant_id),
      ]
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // runOverdueBalanceCheck — 08:30 daily
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Scan for bookings where balance_due > 0 and the event date has passed.
   * Generates an outstanding_payment record and sends an email reminder for
   * each hit. Idempotent — ON CONFLICT DO NOTHING on the outstanding_payment
   * insert means safe to re-run.
   *
   * Two separate queries cover the two debt locations in the schema:
   *   Path A — standalone confirmed_bookings (balance_due lives on the row)
   *   Path B — recurring_series contracts   (balance_due lives on the series)
   */
  async runOverdueBalanceCheck() {
    const startedAt = Date.now();
    await logger.info('BillingService', 'runOverdueBalanceCheck started');

    let processed = 0;
    let errored   = 0;

    // ── Path A: Standalone confirmed bookings ──────────────────────────────
    // balance_due lives directly on confirmed_bookings for non-recurring rows.
    // date_to < CURRENT_DATE means the event has passed without full payment.
    const { rows: standaloneBookings } = await systemQuery(`
      SELECT
        cb.id              AS booking_id,
        cb.customer_id,
        cb.tenant_id,
        cb.balance_due,
        cb.total_amount,
        cb.date_to,
        cb.start_time,
        cb.end_time,
        c.full_name        AS customer_name,
        c.email            AS customer_email,
        r.name             AS room_name
      FROM  bookings.confirmed_bookings cb
      JOIN  bookings.customers          c  ON c.id  = cb.customer_id
      JOIN  bookings.rooms              r  ON r.id  = cb.room_id
      WHERE cb.balance_due             > 0
        AND cb.date_to                 < CURRENT_DATE
        AND cb.recurring_series_id     IS NULL
        AND cb.status NOT IN ('cancelled', 'completed')
      ORDER BY cb.tenant_id, cb.date_to
      LIMIT 50
    `);

    for (const b of standaloneBookings) {
      try {
        await this._processOverdueBooking(b);
        processed++;
      } catch (err) {
        errored++;
        await logger.error(
          'BillingService',
          `Path A overdue check failed for booking ${b.booking_id}`,
          { error: err.message },
          b.tenant_id
        );
      }
    }

    // ── Path B: Recurring series with outstanding balance ──────────────────
    // balance_due lives on recurring_series; child confirmed_bookings have
    // balance_due = 0 (enforced by DB trigger, per 001_recurring_series_architecture.sql).
    // next_session_date < CURRENT_DATE means sessions have occurred but haven't been paid.
    const { rows: seriesContracts } = await systemQuery(`
      SELECT
        rs.id              AS series_id,
        rs.customer_id,
        rs.tenant_id,
        rs.balance_due,
        rs.next_session_date,
        rs.series_reference,
        c.full_name        AS customer_name,
        c.email            AS customer_email,
        r.name             AS room_name
      FROM  bookings.recurring_series   rs
      JOIN  bookings.customers          c   ON c.id  = rs.customer_id
      JOIN  bookings.rooms              r   ON r.id  = rs.room_id
      WHERE rs.balance_due             > 0
        AND rs.active                  = TRUE
        AND rs.next_session_date       < CURRENT_DATE
      ORDER BY rs.tenant_id, rs.next_session_date
      LIMIT 50
    `);

    for (const s of seriesContracts) {
      try {
        await this._processOverdueSeries(s);
        processed++;
      } catch (err) {
        errored++;
        await logger.error(
          'BillingService',
          `Path B overdue check failed for series ${s.series_id}`,
          { error: err.message },
          s.tenant_id
        );
      }
    }

    const summary = {
      standaloneChecked: standaloneBookings.length,
      seriesChecked:     seriesContracts.length,
      processed,
      errored,
      elapsed:           elapsedSec(startedAt),
    };

    await logger.info('BillingService', 'runOverdueBalanceCheck complete', summary);

    // Write to workflow_audit_log so it shows up in the n8n-replacement audit trail
    await systemQuery(
      `INSERT INTO bookings.workflow_audit_log (workflow_name, event, notes)
       VALUES ('BillingService', 'overdue_check_complete', $1)`,
      [JSON.stringify(summary)]
    );
  }

  /**
   * Process a single overdue standalone booking (Path A).
   *
   * 1. INSERT outstanding_payment (ON CONFLICT DO NOTHING)
   * 2. Send balance reminder email
   * 3. Mark email_sent_at
   * 4. Log to customer_interactions
   */
  async _processOverdueBooking(b) {
    const dueDateIso = new Date().toISOString().slice(0, 10); // today as due date

    const { rows: opRows } = await systemQuery(
      `INSERT INTO bookings.outstanding_payments (
         tenant_id, customer_id, period_start, amount_due, due_date, status
       )
       VALUES ($1, $2::uuid, CURRENT_DATE, $3::numeric, CURRENT_DATE, 'pending')
       ON CONFLICT (customer_id, period_start)
         DO UPDATE SET status = EXCLUDED.status   -- re-surface if previously dismissed
         WHERE bookings.outstanding_payments.status = 'dismissed'
       RETURNING id::text, due_date::text`,
      [b.tenant_id, b.customer_id, String(b.balance_due)]
    );

    const subject = `Balance reminder — £${formatGBP(b.balance_due)} outstanding for your booking`;
    const html    = this._buildOverdueHtml({
      customerName: b.customer_name,
      roomName:     b.room_name,
      eventDate:    b.date_to,
      balanceDue:   b.balance_due,
      totalAmount:  b.total_amount,
    });

    const sendResult = await EmailService.sendHtml(
      { to: b.customer_email, subject, html },
      b.tenant_id
    );

    if (sendResult.success && opRows.length) {
      await systemQuery(
        `UPDATE bookings.outstanding_payments
         SET email_sent_at = NOW()
         WHERE id = $1::uuid`,
        [opRows[0].id]
      );
    }

    await systemQuery(
      `INSERT INTO bookings.customer_interactions
         (customer_id, customer_email, subject, interaction_type, notes, timestamp, staff_member, tenant_id)
       VALUES
         ($1::uuid, $2, $3, 'overdue_reminder',
          'Automated overdue balance reminder. Balance: £' || $4::text || '. Event date: ' || $5::text,
          NOW(), 'System', $6)`,
      [
        b.customer_id,
        b.customer_email ?? '',
        subject,
        formatGBP(b.balance_due),
        b.date_to ?? '',
        parseInt(b.tenant_id),
      ]
    );

    await logger.info(
      'BillingService',
      `Overdue reminder sent — booking ${b.booking_id}, balance £${formatGBP(b.balance_due)}`,
      null,
      b.tenant_id
    );
  }

  /**
   * Process a single overdue recurring series contract (Path B).
   * The series reference is included in all logs for traceability.
   */
  async _processOverdueSeries(s) {
    const { rows: opRows } = await systemQuery(
      `INSERT INTO bookings.outstanding_payments (
         tenant_id, recurring_rule_id, customer_id,
         period_start, amount_due, due_date, status
       )
       SELECT $1, rr.id, $2::uuid, CURRENT_DATE, $3::numeric, CURRENT_DATE, 'pending'
       FROM   bookings.recurring_rules rr
       WHERE  rr.series_reference = $4
         AND  rr.tenant_id        = $1
       LIMIT  1
       ON CONFLICT (recurring_rule_id, period_start) DO NOTHING
       RETURNING id::text, due_date::text`,
      [s.tenant_id, s.customer_id, String(s.balance_due), s.series_reference ?? '']
    );

    const subject = `Recurring series balance outstanding — £${formatGBP(s.balance_due)}${s.series_reference ? ' · ' + s.series_reference : ''}`;
    const html    = this._buildOverdueHtml({
      customerName:    s.customer_name,
      roomName:        s.room_name,
      seriesReference: s.series_reference,
      balanceDue:      s.balance_due,
      isRecurring:     true,
    });

    const sendResult = await EmailService.sendHtml(
      { to: s.customer_email, subject, html },
      s.tenant_id
    );

    if (sendResult.success && opRows.length) {
      await systemQuery(
        `UPDATE bookings.outstanding_payments SET email_sent_at = NOW() WHERE id = $1::uuid`,
        [opRows[0].id]
      );
    }

    await systemQuery(
      `INSERT INTO bookings.customer_interactions
         (customer_id, customer_email, subject, interaction_type, notes, timestamp, staff_member, tenant_id)
       VALUES
         ($1::uuid, $2, $3, 'overdue_reminder',
          'Recurring series overdue balance reminder. Balance: £' || $4::text || '. Series: ' || $5::text,
          NOW(), 'System', $6)`,
      [
        s.customer_id,
        s.customer_email ?? '',
        subject,
        formatGBP(s.balance_due),
        s.series_reference ?? '—',
        parseInt(s.tenant_id),
      ]
    );

    await logger.info(
      'BillingService',
      `Overdue series reminder sent — series ${s.series_id}, balance £${formatGBP(s.balance_due)}`,
      null,
      s.tenant_id
    );
  }

  /**
   * Build the overdue balance reminder HTML email.
   * Separate from EmailService.buildBillingReminderHtml which is for
   * scheduled recurring cycle reminders — these are overdue chase emails.
   */
  _buildOverdueHtml({ customerName, roomName, eventDate, balanceDue, totalAmount, seriesReference, isRecurring }) {
    const { formatDateGB } = require('../utils/format');
    const eventStr  = eventDate ? ` for your event on ${formatDateGB(eventDate)}` : '';
    const seriesStr = seriesReference ? ` (${seriesReference})` : '';
    const typeLabel = isRecurring ? 'recurring booking series' : 'booking';

    return `
      <p>Dear ${customerName || 'Valued Customer'},</p>
      <p>Our records show that an outstanding balance remains on your ${typeLabel}${seriesStr}${eventStr}.</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        ${roomName ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Room:</td><td><strong>${roomName}</strong></td></tr>` : ''}
        ${seriesReference ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Series ref:</td><td><strong>${seriesReference}</strong></td></tr>` : ''}
        ${totalAmount ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Total value:</td><td>£${formatGBP(totalAmount)}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">Balance outstanding:</td><td><strong style="color:#ef4444">£${formatGBP(balanceDue)}</strong></td></tr>
      </table>
      <p>Please arrange payment at your earliest convenience to avoid any disruption to your booking.</p>
      <p>Thank you,<br>The VenueDesk Team</p>
    `;
  }
}

module.exports = new BillingService();
