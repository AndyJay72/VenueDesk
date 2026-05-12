/**
 * recurringBookingService.js
 * VenueDesk — Recurring Series Creator
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the Parent-Child recurring booking model:
 *
 *   recurring_series (PARENT)  → owns balance_due, configuration, contract value
 *       ↑  FK (recurring_series_id)
 *   confirmed_bookings (CHILD) → balance_due ALWAYS 0, inherits tenant_id
 *
 * Usage (standalone Node.js or as an n8n Code node body):
 *
 *   const svc = new RecurringBookingService(pool);  // pool = pg Pool instance
 *   const result = await svc.createSeries({
 *     tenant_id:       1001,
 *     customer_id:     'uuid...',
 *     room_id:         'uuid...',
 *     rate_per_session: 80,        // £/session
 *     hours_per_session: 2,        // used only if rate is per-hour; set 1 for fixed/session
 *     sessions:        10,         // total sessions in the contract
 *     frequency:       'weekly',   // weekly | fortnightly | monthly | daily
 *     start_date:      '2025-06-02',
 *     start_time:      '09:00',
 *     end_time:        '11:00',
 *     series_name:     'Yoga — Mon 9am',
 *     notes:           '',
 *     performed_by:    'Staff Name',
 *   });
 *
 * Dependencies: pg (node-postgres)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const FREQUENCY_DAYS = {
    weekly:      7,
    fortnightly: 14,
    monthly:     null,  // handled separately — same weekday, next month
    daily:       1,
};

const SESSIONS_PER_CYCLE = {
    weekly:      4,
    fortnightly: 2,
    monthly:     1,
    daily:       30,
};

// ─── Main Service Class ───────────────────────────────────────────────────────

class RecurringBookingService {
    /**
     * @param {import('pg').Pool} pool — pg connection pool
     */
    constructor(pool) {
        this.pool = pool;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC: createSeries
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Creates a complete recurring series: one parent row in recurring_series
     * and N child rows in confirmed_bookings (all with balance_due = 0).
     *
     * @param {object} input
     * @param {number}  input.tenant_id          — REQUIRED. Must match customer's tenant.
     * @param {string}  input.customer_id         — UUID. REQUIRED.
     * @param {string}  input.room_id             — UUID. REQUIRED.
     * @param {number}  input.rate_per_session    — £ per session (not per hour). REQUIRED.
     * @param {number}  [input.hours_per_session] — only used to derive rate when rate is hourly.
     * @param {number}  input.sessions            — total sessions in the contract. REQUIRED.
     * @param {string}  input.frequency           — weekly | fortnightly | monthly | daily.
     * @param {string}  input.start_date          — 'YYYY-MM-DD'. REQUIRED.
     * @param {string}  input.start_time          — 'HH:MM'.
     * @param {string}  input.end_time            — 'HH:MM'.
     * @param {string}  [input.series_name]       — human label for this series.
     * @param {string}  [input.notes]
     * @param {string}  [input.performed_by]      — staff name for audit log.
     * @param {string}  [input.billing_type]      — monthly | per_session | upfront.
     * @param {string}  [input.payment_timing]    — in_advance | in_arrears.
     * @returns {Promise<SeriesResult>}
     */
    async createSeries(input) {
        // ── 1. Validate inputs ──────────────────────────────────────────────
        this._validateInput(input);

        const {
            tenant_id,
            customer_id,
            room_id,
            rate_per_session,
            hours_per_session = 1,
            sessions,
            frequency = 'weekly',
            start_date,
            start_time = '09:00',
            end_time   = '10:00',
            series_name = 'Unnamed Series',
            notes = '',
            performed_by = 'System',
            billing_type   = 'monthly',
            payment_timing = 'in_advance',
        } = input;

        // ── 2. Tenant validation ────────────────────────────────────────────
        await this._assertCustomerBelongsToTenant(customer_id, tenant_id);

        // ── 3. Calculate contract economics ────────────────────────────────
        const sessionsCount    = Math.max(1, Math.floor(sessions));
        const ratePerSession   = parseFloat(rate_per_session);   // £ per session
        const totalPrice       = parseFloat((ratePerSession * sessionsCount).toFixed(2));
        const sessPerCycle     = SESSIONS_PER_CYCLE[frequency] ?? 4;
        const cycleAmount      = parseFloat((ratePerSession * sessPerCycle).toFixed(2));
        const dayOfWeek        = new Date(start_date + 'T00:00:00').getDay();  // 0=Sun

        // ── 4. Generate session dates ───────────────────────────────────────
        const dates = this._generateDates(start_date, frequency, sessionsCount);

        // ── 5. Run everything in a single transaction ───────────────────────
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // ── 5a. Insert parent (recurring_series) ───────────────────────
            const parentRow = await this._insertParent(client, {
                tenant_id,
                customer_id,
                room_id,
                series_name,
                frequency,
                day_of_week:       dayOfWeek,
                start_time,
                end_time,
                start_date,
                end_date:          dates[dates.length - 1],
                rate_per_session:  ratePerSession,
                sessions_per_cycle: sessPerCycle,
                total_sessions:    sessionsCount,
                cycle_amount:      cycleAmount,
                agreed_price:      totalPrice,
                balance_due:       totalPrice,  // ← all debt starts on parent
                billing_type,
                payment_timing,
                notes,
            });

            const seriesId = parentRow.id;

            // ── 5b. Insert child sessions (confirmed_bookings) ─────────────
            const children = await this._insertChildren(client, {
                tenant_id,
                customer_id,
                room_id,
                series_id:        seriesId,
                start_time,
                end_time,
                rate_per_session: ratePerSession,  // stored on child for reference
                dates,
                series_name,
            });

            // ── 5c. Write audit log entry ──────────────────────────────────
            await this._logCreation(client, {
                tenant_id,
                customer_id,
                series_id:    seriesId,
                series_name,
                total_price:  totalPrice,
                sessions:     sessionsCount,
                performed_by,
            });

            await client.query('COMMIT');

            return {
                status:       'success',
                series_id:    seriesId,
                series_name:  parentRow.series_name,
                total_price:  totalPrice,
                balance_due:  totalPrice,
                sessions_created: children.length,
                session_dates:    children.map(c => c.date_from),
                first_session:    children[0]?.date_from,
                last_session:     children[children.length - 1]?.date_from,
            };

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _validateInput
    // ─────────────────────────────────────────────────────────────────────────

    _validateInput(input) {
        const required = ['tenant_id', 'customer_id', 'room_id', 'rate_per_session', 'sessions', 'start_date'];
        for (const field of required) {
            if (input[field] === undefined || input[field] === null || input[field] === '') {
                throw new ValidationError(`Missing required field: ${field}`);
            }
        }

        if (!Number.isInteger(parseInt(input.tenant_id)) || parseInt(input.tenant_id) <= 0) {
            throw new ValidationError(`tenant_id must be a positive integer, got: ${input.tenant_id}`);
        }

        if (!isUUID(input.customer_id)) {
            throw new ValidationError(`customer_id is not a valid UUID: ${input.customer_id}`);
        }

        if (!isUUID(input.room_id)) {
            throw new ValidationError(`room_id is not a valid UUID: ${input.room_id}`);
        }

        const rate = parseFloat(input.rate_per_session);
        if (isNaN(rate) || rate <= 0) {
            throw new ValidationError(`rate_per_session must be a positive number, got: ${input.rate_per_session}`);
        }

        const sessions = parseInt(input.sessions);
        if (isNaN(sessions) || sessions < 1 || sessions > 520) {
            throw new ValidationError(`sessions must be between 1 and 520, got: ${input.sessions}`);
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) {
            throw new ValidationError(`start_date must be YYYY-MM-DD, got: ${input.start_date}`);
        }

        const freq = input.frequency || 'weekly';
        if (!Object.keys(FREQUENCY_DAYS).includes(freq)) {
            throw new ValidationError(`frequency must be one of: ${Object.keys(FREQUENCY_DAYS).join(', ')}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _assertCustomerBelongsToTenant
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Security check: reject any request where the customer_id does not
     * belong to the calling tenant. This prevents cross-tenant data injection.
     */
    async _assertCustomerBelongsToTenant(customer_id, tenant_id) {
        const res = await this.pool.query(
            `SELECT id
             FROM   bookings.customers
             WHERE  id = $1::uuid
               AND  tenant_id = $2::int
             LIMIT  1`,
            [customer_id, tenant_id]
        );

        if (res.rowCount === 0) {
            throw new TenantIsolationError(
                `Customer ${customer_id} does not exist or does not belong to tenant ${tenant_id}.`
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _generateDates
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns an array of 'YYYY-MM-DD' strings for N sessions starting from start_date.
     *
     * - weekly:      every 7 days
     * - fortnightly: every 14 days
     * - monthly:     same day-of-month, next calendar month
     * - daily:       every 1 day (for intensive courses etc.)
     */
    _generateDates(startDate, frequency, count) {
        const dates = [];
        let current = new Date(startDate + 'T00:00:00');

        for (let i = 0; i < count; i++) {
            dates.push(formatDate(current));

            if (frequency === 'monthly') {
                // Same day number, next month (e.g. 2025-01-15 → 2025-02-15 → 2025-03-15)
                current = addMonths(current, 1);
            } else {
                const days = FREQUENCY_DAYS[frequency];
                current = addDays(current, days);
            }
        }

        return dates;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _insertParent
    // ─────────────────────────────────────────────────────────────────────────

    async _insertParent(client, p) {
        const sql = `
            INSERT INTO bookings.recurring_series (
                tenant_id, customer_id, room_id,
                series_name, frequency, day_of_week,
                start_time, end_time, start_date, end_date,
                rate_per_session, sessions_per_cycle, total_sessions,
                cycle_amount, agreed_price, balance_due,
                billing_type, payment_timing, notes,
                active, created_at, updated_at
            ) VALUES (
                $1,  $2::uuid, $3::uuid,
                $4,  $5,       $6,
                $7::time, $8::time, $9::date, $10::date,
                $11, $12,      $13,
                $14, $15,      $16,
                $17, $18,      $19,
                true, NOW(),   NOW()
            )
            RETURNING id, series_name, agreed_price, balance_due, total_sessions;
        `;

        const params = [
            p.tenant_id,          // $1
            p.customer_id,        // $2
            p.room_id,            // $3
            p.series_name,        // $4
            p.frequency,          // $5
            p.day_of_week,        // $6
            p.start_time,         // $7
            p.end_time,           // $8
            p.start_date,         // $9
            p.end_date,           // $10
            p.rate_per_session,   // $11
            p.sessions_per_cycle, // $12
            p.total_sessions,     // $13
            p.cycle_amount,       // $14
            p.agreed_price,       // $15
            p.balance_due,        // $16 — full contract value; trigger won't touch this table
            p.billing_type,       // $17
            p.payment_timing,     // $18
            p.notes,              // $19
        ];

        const res = await client.query(sql, params);
        return res.rows[0];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _insertChildren
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Inserts N rows into confirmed_bookings.
     *
     * CRITICAL rules enforced here (and also by the DB trigger):
     *   • recurring_series_id = series.id        (links child to parent)
     *   • balance_due         = 0                (debt lives on parent ONLY)
     *   • tenant_id           = parent.tenant_id (inherited, never trusted from input)
     *   • is_recurring        = true
     */
    async _insertChildren(client, {
        tenant_id, customer_id, room_id, series_id,
        start_time, end_time, rate_per_session, dates, series_name,
    }) {
        if (!dates.length) return [];

        // Build a VALUES list for a single multi-row INSERT (faster than N individual INSERTs)
        const valueParts  = [];
        const params      = [];
        let   paramIndex  = 1;

        for (const date of dates) {
            valueParts.push(`(
                $${paramIndex++},        -- tenant_id
                $${paramIndex++}::uuid,  -- customer_id
                $${paramIndex++}::uuid,  -- room_id
                $${paramIndex++}::uuid,  -- recurring_series_id
                $${paramIndex++}::date,  -- booking_date
                $${paramIndex++}::date,  -- date_from
                $${paramIndex++}::date,  -- date_to
                $${paramIndex++}::time,  -- start_time
                $${paramIndex++}::time,  -- end_time
                $${paramIndex++},        -- total_amount (rate for reference)
                0,                       -- balance_due  ← ALWAYS 0 for children
                'confirmed',             -- status
                true,                    -- is_recurring
                $${paramIndex++},        -- series_label
                NOW(),                   -- created_at
                NOW()                    -- updated_at
            )`);

            params.push(
                tenant_id,
                customer_id,
                room_id,
                series_id,
                date,          // booking_date
                date,          // date_from
                date,          // date_to
                start_time,
                end_time,
                rate_per_session,  // total_amount — per-session rate, for display
                series_name,       // series_label
            );
        }

        const sql = `
            INSERT INTO bookings.confirmed_bookings (
                tenant_id, customer_id, room_id,
                recurring_series_id,
                booking_date, date_from, date_to,
                start_time, end_time,
                total_amount,
                balance_due,
                status,
                is_recurring,
                series_label,
                created_at, updated_at
            ) VALUES ${valueParts.join(',\n')}
            RETURNING id, date_from::text, balance_due;
        `;

        const res = await client.query(sql, params);

        // Safety: verify trigger ran and all children have balance_due = 0
        const nonZero = res.rows.filter(r => parseFloat(r.balance_due) !== 0);
        if (nonZero.length > 0) {
            // Trigger should have caught this — if we reach here it means the trigger
            // is not installed. Raise so the transaction rolls back.
            throw new Error(
                `INVARIANT VIOLATION: ${nonZero.length} child session(s) have balance_due != 0. ` +
                `Run 001_recurring_series_architecture.sql to install the trigger.`
            );
        }

        return res.rows;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE: _logCreation
    // ─────────────────────────────────────────────────────────────────────────

    async _logCreation(client, { tenant_id, customer_id, series_id, series_name, total_price, sessions, performed_by }) {
        await client.query(
            `INSERT INTO bookings.customer_interactions
                (customer_id, subject, interaction_type, notes, staff_member, tenant_id, timestamp)
             VALUES ($1::uuid, $2, 'recurring_booking', $3, $4, $5, NOW())`,
            [
                customer_id,
                `Recurring series created: ${series_name}`,
                `Series ID: ${series_id}. ` +
                `${sessions} sessions. Total value: £${total_price.toFixed(2)}.`,
                performed_by,
                tenant_id,
            ]
        );
    }
}

// ─── Error Types ─────────────────────────────────────────────────────────────

class ValidationError extends Error {
    constructor(msg) { super(msg); this.name = 'ValidationError'; this.statusCode = 400; }
}

class TenantIsolationError extends Error {
    constructor(msg) { super(msg); this.name = 'TenantIsolationError'; this.statusCode = 403; }
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function formatDate(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function addMonths(date, months) {
    const d = new Date(date);
    const originalDay = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month-end edge cases: if March 31 + 1 month lands on April 30, keep April 30
    if (d.getDate() !== originalDay) {
        d.setDate(0); // last day of the target month
    }
    return d;
}

function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { RecurringBookingService, ValidationError, TenantIsolationError };

// ─── Standalone Example ───────────────────────────────────────────────────────
// Uncomment to run directly:  node recurringBookingService.js
//
// const { Pool } = require('pg');
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const svc = new RecurringBookingService(pool);
// svc.createSeries({
//     tenant_id:        1001,
//     customer_id:      'YOUR-CUSTOMER-UUID',
//     room_id:          'YOUR-ROOM-UUID',
//     rate_per_session: 80,
//     sessions:         10,
//     frequency:        'weekly',
//     start_date:       '2025-06-02',
//     start_time:       '09:00',
//     end_time:         '11:00',
//     series_name:      'Test Series',
//     performed_by:     'Admin',
// }).then(console.log).catch(console.error).finally(() => pool.end());
