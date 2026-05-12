/**
 * balanceService.js
 * VenueDesk — Balance Calculation Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for "what does this booking owe?".
 *
 * ROUTING RULE:
 *   booking.recurring_series_id IS NULL   →  single booking
 *                                             balance = booking.total_amount − Σ payments
 *
 *   booking.recurring_series_id IS NOT NULL →  child of a recurring series
 *                                               balance = recurring_series.balance_due
 *                                               (debt lives on the PARENT, not the child row)
 *
 * This service also handles payment processing and ensures that recording a
 * payment against a recurring child updates the PARENT series, not the child.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

class BalanceService {
    /**
     * @param {import('pg').Pool} pool
     */
    constructor(pool) {
        this.pool = pool;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: getBalance
    // Returns the correct outstanding balance for any booking_id.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {string} booking_id  — UUID of the confirmed_booking
     * @param {number} tenant_id   — for RLS isolation
     * @returns {Promise<BalanceResult>}
     */
    async getBalance(booking_id, tenant_id) {
        assertUUID(booking_id,   'booking_id');
        assertInt(tenant_id,     'tenant_id');

        // 1. Fetch the booking row
        const booking = await this._fetchBooking(booking_id, tenant_id);

        if (!booking) {
            throw new NotFoundError(`Booking ${booking_id} not found for tenant ${tenant_id}`);
        }

        // 2. Route based on whether this is a recurring child
        if (booking.recurring_series_id) {
            return this._recurringBalance(booking, tenant_id);
        } else {
            return this._singleBalance(booking, tenant_id);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: getSeriesBalance
    // Direct lookup of a series by its UUID (e.g. from the management page).
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {string} series_id
     * @param {number} tenant_id
     * @returns {Promise<SeriesBalanceResult>}
     */
    async getSeriesBalance(series_id, tenant_id) {
        assertUUID(series_id, 'series_id');
        assertInt(tenant_id,  'tenant_id');

        const res = await this.pool.query(
            `SELECT
                rs.id::text            AS series_id,
                rs.series_name,
                rs.tenant_id,
                rs.balance_due,
                rs.agreed_price,
                rs.cycle_amount,
                rs.total_sessions,
                rs.sessions_completed,
                rs.active,
                c.full_name            AS customer_name,
                c.email                AS customer_email,
                COALESCE(
                    (SELECT COUNT(*)
                     FROM   bookings.confirmed_bookings cb
                     WHERE  cb.recurring_series_id = rs.id
                       AND  cb.tenant_id           = rs.tenant_id
                       AND  cb.status NOT IN ('cancelled')),
                    0
                )::int                 AS child_session_count,
                COALESCE(
                    (SELECT SUM(p.amount)
                     FROM   bookings.payments p
                     WHERE  p.booking_id IS NULL
                       AND  p.series_reference IS NOT NULL
                       AND  p.series_reference = rs.series_name
                       AND  p.tenant_id        = rs.tenant_id),
                    0
                )::numeric             AS total_paid
             FROM  bookings.recurring_series rs
             JOIN  bookings.customers c ON rs.customer_id = c.id
             WHERE rs.id        = $1::uuid
               AND rs.tenant_id = $2::int`,
            [series_id, tenant_id]
        );

        if (!res.rows.length) {
            throw new NotFoundError(`Series ${series_id} not found for tenant ${tenant_id}`);
        }

        const row = res.rows[0];
        return {
            series_id:          row.series_id,
            series_name:        row.series_name,
            customer_name:      row.customer_name,
            customer_email:     row.customer_email,
            agreed_price:       parseFloat(row.agreed_price),
            balance_due:        parseFloat(row.balance_due),
            total_paid:         parseFloat(row.total_paid),
            sessions_contracted: row.total_sessions,
            sessions_active:    row.child_session_count,
            sessions_completed: row.sessions_completed,
            active:             row.active,
            balance_source:     'recurring_series',
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: recordPayment
    // Records a payment and updates the correct target (series or booking).
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param {object} payment
     * @param {string}  payment.booking_id      — UUID. Used to determine routing.
     * @param {number}  payment.amount           — £ paid. Must be > 0.
     * @param {string}  payment.payment_method   — cash | card | bank_transfer | cheque
     * @param {number}  payment.tenant_id
     * @param {string}  [payment.performed_by]
     * @param {string}  [payment.notes]
     * @returns {Promise<PaymentResult>}
     */
    async recordPayment(payment) {
        const { booking_id, amount, payment_method, tenant_id, performed_by = 'System', notes = '' } = payment;

        assertUUID(booking_id,    'booking_id');
        assertInt(tenant_id,      'tenant_id');
        assertPositiveNumber(amount, 'amount');

        const booking = await this._fetchBooking(booking_id, tenant_id);
        if (!booking) throw new NotFoundError(`Booking ${booking_id} not found`);

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            let result;
            if (booking.recurring_series_id) {
                // RECURRING: update the PARENT series, not the child row
                result = await this._recordRecurringPayment(client, {
                    booking,
                    amount,
                    payment_method,
                    tenant_id,
                    performed_by,
                    notes,
                });
            } else {
                // SINGLE: update the booking row directly
                result = await this._recordSinglePayment(client, {
                    booking,
                    amount,
                    payment_method,
                    tenant_id,
                    performed_by,
                    notes,
                });
            }

            await client.query('COMMIT');
            return result;

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _singleBalance
    // Calculates balance for a standalone (non-recurring) booking.
    // balance = total_amount − Σ(confirmed payments)
    // ─────────────────────────────────────────────────────────────────────────

    async _singleBalance(booking, tenant_id) {
        const totalPaid = await this._sumPayments(booking.id, tenant_id);
        const balanceDue = Math.max(0, parseFloat(booking.total_amount) - totalPaid);

        return {
            booking_id:     booking.id,
            booking_date:   booking.date_from || booking.booking_date,
            customer_id:    booking.customer_id,
            total_amount:   parseFloat(booking.total_amount),
            total_paid:     totalPaid,
            balance_due:    balanceDue,
            balance_source: 'booking',
            series_id:      null,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _recurringBalance
    // Returns the parent series balance for a recurring child booking.
    // The child's own balance_due is always 0 (enforced by DB trigger).
    // ─────────────────────────────────────────────────────────────────────────

    async _recurringBalance(booking, tenant_id) {
        const seriesRes = await this.pool.query(
            `SELECT id::text, series_name, balance_due, agreed_price, active
             FROM   bookings.recurring_series
             WHERE  id        = $1::uuid
               AND  tenant_id = $2::int`,
            [booking.recurring_series_id, tenant_id]
        );

        if (!seriesRes.rows.length) {
            // Series was deleted but child still linked — fall back to child row
            return {
                booking_id:     booking.id,
                booking_date:   booking.date_from || booking.booking_date,
                customer_id:    booking.customer_id,
                total_amount:   parseFloat(booking.total_amount),
                total_paid:     null,
                balance_due:    0,  // trigger zeroed it; no parent found
                balance_source: 'booking_fallback',
                series_id:      booking.recurring_series_id,
                warning:        'Parent recurring_series not found; balance may be stale.',
            };
        }

        const series = seriesRes.rows[0];

        return {
            booking_id:     booking.id,
            booking_date:   booking.date_from || booking.booking_date,
            customer_id:    booking.customer_id,
            total_amount:   parseFloat(booking.total_amount),
            total_paid:     null,  // payment tracking is at series level
            balance_due:    parseFloat(series.balance_due),  // PARENT balance
            balance_source: 'recurring_series',
            series_id:      series.id,
            series_name:    series.series_name,
            agreed_price:   parseFloat(series.agreed_price),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _recordRecurringPayment
    // ─────────────────────────────────────────────────────────────────────────

    async _recordRecurringPayment(client, { booking, amount, payment_method, tenant_id, performed_by, notes }) {
        const seriesId = booking.recurring_series_id;

        // A. Fetch the series (with lock to prevent concurrent double-payments)
        const seriesRes = await client.query(
            `SELECT id, balance_due, agreed_price, series_name, customer_id
             FROM   bookings.recurring_series
             WHERE  id        = $1::uuid
               AND  tenant_id = $2::int
             FOR UPDATE`,
            [seriesId, tenant_id]
        );

        if (!seriesRes.rows.length) {
            throw new NotFoundError(`Series ${seriesId} not found`);
        }

        const series    = seriesRes.rows[0];
        const oldBalance = parseFloat(series.balance_due);
        const paidNow   = Math.min(amount, oldBalance);  // can't overpay below 0
        const newBalance = Math.max(0, oldBalance - paidNow);

        // B. Reduce series.balance_due
        await client.query(
            `UPDATE bookings.recurring_series
             SET    balance_due  = $1,
                    updated_at   = NOW()
             WHERE  id           = $2::uuid
               AND  tenant_id    = $3::int`,
            [newBalance, seriesId, tenant_id]
        );

        // C. Mark oldest unpaid child sessions as paid (up to the amount received)
        // Each child session represents rate_per_session worth of credit.
        const markRes = await client.query(
            `WITH oldest_unpaid AS (
                SELECT id
                FROM   bookings.confirmed_bookings
                WHERE  recurring_series_id = $1::uuid
                  AND  tenant_id           = $2::int
                  AND  status NOT IN ('cancelled', 'fully_paid')
                ORDER  BY COALESCE(date_from, booking_date) ASC
                LIMIT  FLOOR($3::numeric / NULLIF(
                    (SELECT rate_per_session FROM bookings.recurring_series WHERE id = $1::uuid),
                    0
                ))
             )
             UPDATE bookings.confirmed_bookings
             SET    status     = 'fully_paid',
                    updated_at = NOW()
             WHERE  id IN (SELECT id FROM oldest_unpaid)
             RETURNING id`,
            [seriesId, tenant_id, paidNow]
        );

        // D. Record the payment in bookings.payments
        const refRes = await client.query(
            `INSERT INTO bookings.payments (
                booking_id, customer_id, payment_type, amount,
                payment_method, status, reference_number,
                series_reference, tenant_id, payment_date
             ) VALUES (
                NULL,              -- no single booking_id (series payment)
                $1::uuid,
                'recurring_payment',
                $2::numeric,
                $3,
                'completed',
                'REC-' || TO_CHAR(NOW(),'YYYYMMDD-HH24MI') || '-' || LEFT(gen_random_uuid()::text,8),
                $4,
                $5::int,
                NOW()
             ) RETURNING id::text, reference_number`,
            [
                series.customer_id,
                paidNow,
                payment_method,
                series.series_name,
                tenant_id,
            ]
        );

        const ref = refRes.rows[0]?.reference_number;

        return {
            status:           'success',
            payment_type:     'recurring_series',
            series_id:        seriesId,
            amount_paid:      paidNow,
            old_balance:      oldBalance,
            new_balance:      newBalance,
            sessions_marked_paid: markRes.rowCount,
            reference:        ref,
            performed_by,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _recordSinglePayment
    // Updates a standard (non-recurring) booking's balance.
    // ─────────────────────────────────────────────────────────────────────────

    async _recordSinglePayment(client, { booking, amount, payment_method, tenant_id, performed_by }) {
        const oldBalance = parseFloat(booking.balance_due);
        const paidNow   = Math.min(amount, oldBalance);
        const newBalance = Math.max(0, oldBalance - paidNow);
        const isFully   = newBalance === 0;

        // A. Update booking row
        await client.query(
            `UPDATE bookings.confirmed_bookings
             SET    balance_due  = $1,
                    deposit_paid = deposit_paid + $2,
                    status       = CASE WHEN $1 = 0 THEN 'fully_paid' ELSE status END,
                    updated_at   = NOW()
             WHERE  id           = $3::uuid
               AND  tenant_id    = $4::int`,
            [newBalance, paidNow, booking.id, tenant_id]
        );

        // B. Record in payments
        const refRes = await client.query(
            `INSERT INTO bookings.payments (
                booking_id, customer_id, payment_type, amount,
                payment_method, status, reference_number, tenant_id, payment_date
             ) VALUES (
                $1::uuid, $2::uuid,
                CASE WHEN $6 = 0 THEN 'balance' ELSE 'deposit' END,
                $3::numeric, $4, 'completed',
                'PAY-' || TO_CHAR(NOW(),'YYYYMMDD-HH24MI') || '-' || LEFT(gen_random_uuid()::text,8),
                $5::int, NOW()
             ) RETURNING reference_number`,
            [booking.id, booking.customer_id, paidNow, payment_method, tenant_id, newBalance]
        );

        return {
            status:       'success',
            payment_type: 'single_booking',
            booking_id:   booking.id,
            amount_paid:  paidNow,
            old_balance:  oldBalance,
            new_balance:  newBalance,
            fully_paid:   isFully,
            reference:    refRes.rows[0]?.reference_number,
            performed_by,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: Helpers
    // ─────────────────────────────────────────────────────────────────────────

    async _fetchBooking(booking_id, tenant_id) {
        const res = await this.pool.query(
            `SELECT id::text, customer_id::text, room_id::text,
                    recurring_series_id::text,
                    total_amount, balance_due, deposit_paid, status,
                    date_from::text, booking_date::text
             FROM   bookings.confirmed_bookings
             WHERE  id        = $1::uuid
               AND  tenant_id = $2::int`,
            [booking_id, tenant_id]
        );
        return res.rows[0] || null;
    }

    async _sumPayments(booking_id, tenant_id) {
        const res = await this.pool.query(
            `SELECT COALESCE(SUM(amount), 0)::numeric AS total_paid
             FROM   bookings.payments
             WHERE  booking_id = $1::uuid
               AND  tenant_id  = $2::int
               AND  status     = 'completed'`,
            [booking_id, tenant_id]
        );
        return parseFloat(res.rows[0]?.total_paid ?? 0);
    }
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

function assertUUID(value, name) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new TypeError(`${name} must be a UUID, got: ${value}`);
    }
}

function assertInt(value, name) {
    if (!Number.isInteger(parseInt(value)) || parseInt(value) <= 0) {
        throw new TypeError(`${name} must be a positive integer, got: ${value}`);
    }
}

function assertPositiveNumber(value, name) {
    const n = parseFloat(value);
    if (isNaN(n) || n <= 0) {
        throw new TypeError(`${name} must be a positive number, got: ${value}`);
    }
}

// ─── Error Types ─────────────────────────────────────────────────────────────

class NotFoundError extends Error {
    constructor(msg) { super(msg); this.name = 'NotFoundError'; this.statusCode = 404; }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { BalanceService, NotFoundError };

// ─────────────────────────────────────────────────────────────────────────────
// HOW TO PATCH THE EXISTING pay-balance n8n WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────
//
// In KHvxUBua7hi5e1x1.json, the "DB: Update Balance" node currently runs:
//
//   UPDATE bookings.confirmed_bookings
//   SET balance_due = balance_due - $1, deposit_paid = deposit_paid + $1
//   WHERE id = $2 AND tenant_id = $3
//
// This IGNORES recurring_series_id. Replace the Update Balance SQL with:
//
//   -- Route payment to parent series if applicable, else update booking row.
//   DO $$
//   DECLARE
//     v_series_id UUID;
//   BEGIN
//     SELECT recurring_series_id INTO v_series_id
//     FROM bookings.confirmed_bookings WHERE id = $2::uuid AND tenant_id = $3::int;
//
//     IF v_series_id IS NOT NULL THEN
//       -- Child session: reduce parent series balance
//       UPDATE bookings.recurring_series
//       SET    balance_due = GREATEST(0, balance_due - $1::numeric), updated_at = NOW()
//       WHERE  id = v_series_id AND tenant_id = $3::int;
//     ELSE
//       -- Standard single booking
//       UPDATE bookings.confirmed_bookings
//       SET    balance_due = balance_due - $1::numeric,
//              deposit_paid = deposit_paid + $1::numeric, updated_at = NOW()
//       WHERE  id = $2::uuid AND tenant_id = $3::int;
//     END IF;
//   END $$;
//
// ─────────────────────────────────────────────────────────────────────────────
