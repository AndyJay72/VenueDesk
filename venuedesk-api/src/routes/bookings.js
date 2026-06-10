'use strict';

/**
 * /bookings routes — Phase 2 migration.
 * Replaces n8n Postgres nodes for the core booking lifecycle.
 *
 * Workflows replaced:
 *   POST /bookings/create           ← generic confirmed booking creation
 *   POST /bookings/confirm-request  ← 7ZXOI73BhHLXkyOc Branch A (CreateBookingFromRequest)
 *   POST /bookings/update           ← 7ZXOI73BhHLXkyOc Branch B + generic status/amount update
 *   POST /bookings/cancel           ← AGkUe3zjjFDD0wOL (CancelBooking) +
 *                                      CancelRecurringSeries (recurring series)
 *   POST /bookings/cancel-pending   ← bLsB0v8ZyKpvb8pz (DB: Cancel Request + DB: Cancel Customer)
 *   GET  /bookings/list             ← bLsB0v8ZyKpvb8pz (DB: Bookings — all-bookings path)
 *   GET  /bookings/pending          ← bLsB0v8ZyKpvb8pz (DB: Pending — get-pending-requests path)
 *   GET  /bookings/check-clashes    ← CheckRecurringClashes / CreateRecurringFromCalendar
 *
 * Architectural invariants (CLAUDE.md):
 *   - tenant_id from JWT only, never from the request body.
 *   - All writes inside withTenantContext (SET LOCAL app.tenant_id).
 *   - Child recurring bookings carry balance_due = 0 (enforced by DB trigger).
 *   - Debt on recurring contracts lives exclusively on recurring_series.balance_due.
 */

const { withTenantContext, systemQuery } = require('../db/pool');
const logger                             = require('../services/LoggerService');
const { notFound, conflict, unprocessable, badRequest } = require('../utils/errors');
const { assertUUID, assertRequired, assertNumber, isUUID } = require('../utils/validators');

// ── Overlap guard ─────────────────────────────────────────────────────────────
// Strict Interval Overlap: two time-ranges overlap iff A.start < B.end AND A.end > B.start.
// We parameterise into the query so the DB applies it correctly with TIME type casting.
// The check also guards date range (date_from/date_to) using COALESCE with booking_date.
// ─────────────────────────────────────────────────────────────────────────────

async function customersRoutes(fastify) {

  // ─── GET /bookings/:id ────────────────────────────────────────────────────
  // Fetch a single confirmed booking with customer + room details.
  // Used by cancel/refund workflows (AGkUe3zjjFDD0wOL) and payment receipt
  // email workflows (KHvxUBua7hi5e1x1) to get full booking context.
  //
  // Returns: { id, customer_id, room_id, room_name, booking_date, date_from,
  //            date_to, start_time, end_time, total_amount, deposit_paid,
  //            balance_due, status, tenant_id, customer_name, customer_email,
  //            customer_phone }
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request) => {
    const tenantId   = request.user.tenant_id;
    const { id }     = request.params;
    assertUUID(id, 'id');

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT cb.id,
                cb.customer_id,
                cb.room_id,
                r.name         AS room_name,
                cb.booking_date,
                cb.date_from,
                cb.date_to,
                cb.start_time,
                cb.end_time,
                cb.total_amount,
                cb.deposit_paid,
                cb.balance_due,
                cb.status,
                cb.tenant_id,
                c.full_name    AS customer_name,
                c.email        AS customer_email,
                c.phone        AS customer_phone
         FROM   bookings.confirmed_bookings cb
         LEFT JOIN bookings.customers c ON c.id   = cb.customer_id
         LEFT JOIN bookings.rooms     r ON r.id   = cb.room_id
         WHERE  cb.id        = $1::uuid
           AND  cb.tenant_id = $2::integer
         LIMIT  1`,
        [id, tenantId]
      )
    );

    if (!rows.length) throw notFound('Booking', id);
    return { success: true, data: rows[0] };
  });

  // ─── GET /bookings/check-clashes ──────────────────────────────────────────
  // Replaces: CheckRecurringClashes → DB: Find Clashes
  //
  // Query params:
  //   room_id     UUID   — required
  //   dates       string — comma-separated ISO dates  e.g. "2026-05-01,2026-05-08"
  //   start_time  string — HH:MM
  //   end_time    string — HH:MM
  //
  // Returns: { clashed_dates: string[] }
  // 200 = checked; clashed_dates empty means no conflicts.
  fastify.get('/check-clashes', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['room_id', 'dates', 'start_time', 'end_time'],
        properties: {
          room_id:    { type: 'string' },
          dates:      { type: 'string' },
          start_time: { type: 'string' },
          end_time:   { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { room_id, dates, start_time, end_time } = request.query;

    assertUUID(room_id, 'room_id');

    // ── Strict Interval Overlap check ────────────────────────────────────────
    // For each candidate date, find any confirmed_bookings in the same room on the
    // same date whose time window overlaps: cb.start_time < end_time AND cb.end_time > start_time.
    // Status 'cancelled' rows are excluded — they no longer hold the slot.
    const { rows } = await systemQuery(
      `SELECT COALESCE(
         ARRAY_AGG(d::text ORDER BY d),
         ARRAY[]::text[]
       ) AS clashed_dates
       FROM   unnest(string_to_array($1, ',')) AS d
       WHERE  $1 <> ''
         AND  EXISTS (
           SELECT 1
           FROM   bookings.confirmed_bookings cb
           WHERE  cb.room_id    = $2::uuid
             AND  cb.tenant_id  = $3::integer
             AND  cb.status    NOT IN ('cancelled')
             -- Date overlap: the booking covers this candidate date
             AND  d::date BETWEEN COALESCE(cb.date_from::date, cb.booking_date)
                              AND COALESCE(cb.date_to::date,   cb.booking_date)
             -- Strict interval overlap (no buffer — pure math)
             AND  cb.start_time < $5::time
             AND  cb.end_time   > $4::time
         )`,
      [dates, room_id, tenantId, start_time, end_time]
    );

    return { success: true, data: rows[0] };
  });


  // ─── POST /bookings/create ────────────────────────────────────────────────
  // Replaces: 7ZXOI73BhHLXkyOc (ConfirmBooking workflow).
  //
  // Creates a confirmed booking, optionally:
  //   - Clashes check before insert (returns 409 if slot taken)
  //   - Records a deposit payment
  //   - Closes an originating booking_request
  //   - Logs a customer_interaction
  //
  // Body:
  //   customer_id       UUID    required
  //   room_id           UUID    required
  //   booking_date      date    required (ISO string)
  //   start_time        string  required (HH:MM)
  //   end_time          string  required (HH:MM)
  //   date_from         date    optional (defaults to booking_date)
  //   date_to           date    optional (defaults to booking_date)
  //   total_amount      number  default 0
  //   balance_due       number  default total_amount
  //   deposit_amount    number  default 0 — recorded in payments if > 0
  //   payment_method    string  default 'cash'
  //   status            string  default 'confirmed'
  //   booking_request_id UUID   optional — closed if provided
  //   check_clashes     bool    default true — reject on overlap
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id', 'booking_date', 'start_time', 'end_time'],
        properties: {
          customer_id:         { type: 'string' },
          room_id:             { type: 'string' },
          booking_date:        { type: 'string' },
          date_from:           { type: 'string' },
          date_to:             { type: 'string' },
          start_time:          { type: 'string' },
          end_time:            { type: 'string' },
          total_amount:        { type: 'number', default: 0 },
          balance_due:         { type: 'number' },
          deposit_amount:      { type: 'number', default: 0 },
          payment_method: { type: 'string', default: 'cash' },
          status: {
            type: 'string',
            default: 'confirmed',
            enum: ['confirmed', 'pending', 'provisional', 'deposit_paid',
                   'cancelled', 'fully_paid', 'paid', 'overridden'],
          },
          guest_count: { type: 'integer' },
          booking_request_id: { type: 'string' },
          check_clashes:      { type: 'boolean', default: true },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      booking_date,
      start_time,
      end_time,
      date_from        = booking_date,
      date_to          = booking_date,
      total_amount     = 0,
      deposit_amount   = 0,
      payment_method   = 'cash',
      status             = 'confirmed',
      guest_count        = null,
      booking_request_id,
      check_clashes      = true,
    } = request.body;

    // Derive balance_due: explicit value wins, fallback = total − deposit
    const balance_due = request.body.balance_due != null
      ? request.body.balance_due
      : Math.max(0, total_amount - deposit_amount);

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id, 'room_id');
    if (booking_request_id) assertUUID(booking_request_id, 'booking_request_id');

    // Runtime guard — AJV's anyOf+minimum combo can pass 0 in strict mode;
    // defend at the handler level so the DB never receives an invalid count.
    if (guest_count !== null && guest_count !== undefined && guest_count < 1) {
      throw badRequest('guest_count must be at least 1');
    }

    // ── Historical booking protection ─────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD server date
    const effectiveFrom = date_from || booking_date;
    if (booking_date < today || effectiveFrom < today) {
      throw badRequest('Cannot create or register a venue reservation block in the past.');
    }

    // ── Maximum booking duration (90-day ceiling) ─────────────────────────
    const msPerDay     = 86_400_000;
    const durationDays = Math.round((new Date(date_to) - new Date(date_from)) / msPerDay);
    if (durationDays > 90) {
      throw badRequest('Booking duration exceeds maximum allowed limit of 90 days.');
    }

    if (start_time >= end_time) {
      throw unprocessable('end_time must be after start_time');
    }

    return withTenantContext(tenantId, async (client) => {
      if (check_clashes) {
        // ── Room lookup (capacity validation) ────────────────────────────
        const { rows: [room] } = await client.query(
          `SELECT id, capacity
           FROM   bookings.rooms
           WHERE  id        = $1::uuid
             AND  tenant_id = $2::integer`,
          [room_id, tenantId]
        );

        if (!room) throw notFound('Room', room_id);

        // ── Capacity ceiling ──────────────────────────────────────────────
        // capacity = 0 means unconstrained (legacy rooms with no limit set).
        if (guest_count !== null && room.capacity > 0 && guest_count > room.capacity) {
          throw badRequest(
            `guest_count ${guest_count} exceeds room capacity of ${room.capacity}`
          );
        }

        // ── Overlap clash check ───────────────────────────────────────────
        const { rows: clashRows } = await client.query(
          `SELECT id
           FROM   bookings.confirmed_bookings
           WHERE  room_id    = $1::uuid
             AND  tenant_id  = $2::integer
             AND  status    NOT IN ('cancelled')
             AND  COALESCE(date_from::date, booking_date) <= $4::date
             AND  COALESCE(date_to::date,   booking_date) >= $3::date
             AND  start_time < $6::time
             AND  end_time   > $5::time
           LIMIT 1`,
          [room_id, tenantId, date_from, date_to, start_time, end_time]
        );

        if (clashRows.length) {
          throw conflict('Booking', `room ${room_id} is already booked for this date/time`);
        }
      }

      // ── Insert confirmed_booking ──────────────────────────────────────────
      const { rows: [booking] } = await client.query(
        `INSERT INTO bookings.confirmed_bookings
           (tenant_id, customer_id, room_id,
            booking_date, date_from, date_to,
            start_time, end_time,
            total_amount, deposit_paid, balance_due,
            status, guest_count)
         VALUES ($1, $2::uuid, $3::uuid,
                 $4::date, $5::date, $6::date,
                 $7::time, $8::time,
                 $9, $10, $11,
                 $12, $13)
         RETURNING id, booking_date, date_from, date_to, start_time, end_time,
                   total_amount, balance_due, deposit_paid, status, guest_count`,
        [
          tenantId, customer_id, room_id,
          booking_date, date_from, date_to,
          start_time, end_time,
          total_amount, deposit_amount, balance_due,
          status, guest_count,
        ]
      );

      // ── Record deposit in payments (skip card — Stripe webhook owns it) ──
      if (deposit_amount > 0 && payment_method !== 'card') {
        await client.query(
          `INSERT INTO bookings.payments
             (booking_id, customer_id, amount, payment_type, payment_method,
              status, tenant_id, reference_number)
           SELECT $1::uuid, $2::uuid, $3::numeric, 'deposit', $4,
                  'received', $5,
                  'DEP-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || UPPER(LEFT(MD5(RANDOM()::text), 4))
           WHERE $3::numeric > 0`,
          [booking.id, customer_id, deposit_amount, payment_method, tenantId]
        );
      }

      // ── Close booking_request ─────────────────────────────────────────────
      if (booking_request_id) {
        await client.query(
          `UPDATE bookings.booking_requests
           SET    status = 'booked'
           WHERE  id = $1::uuid AND tenant_id = $2`,
          [booking_request_id, tenantId]
        );
        await client.query(
          `UPDATE bookings.customers
           SET    status = 'booked', updated_at = NOW()
           WHERE  id = $1::uuid AND tenant_id = $2`,
          [customer_id, tenantId]
        );
      }

      // ── Log interaction ───────────────────────────────────────────────────
      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, booking_id,
            subject, interaction_type, notes, staff_member, timestamp)
         SELECT $1, $2::uuid, $3::uuid,
                'Booking confirmed: ' || COALESCE(r.name, '') || ' | ' || $4::text,
                'booking_confirmed',
                'Created via VenueDesk API',
                'VenueDesk API', NOW()
         FROM   bookings.rooms r
         WHERE  r.id = $5::uuid`,
        [tenantId, customer_id, booking.id, booking_date, room_id]
      );

      await logger.info(
        'BookingsRoute',
        `Booking created: ${booking.id}`,
        { booking_id: booking.id, customer_id, room_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: booking };
    });
  });


  // ─── POST /bookings/confirm-request ──────────────────────────────────────
  // Replaces: 7ZXOI73BhHLXkyOc Branch A (DB: Create Booking From Request →
  //           DB: Close Request → DB: Record Deposit → DB: Log Confirm Interaction).
  //
  // Creates one or more confirmed_bookings from an existing booking_request,
  // records deposit, closes the request, marks customer booked, logs interaction —
  // all inside a single transaction.
  //
  // Body:
  //   request_id      UUID   required
  //   customer_id     UUID   required
  //   total_amount    number default 0
  //   balance_due     number default (total_amount − deposit_amount)
  //   deposit_amount  number default 0
  //   payment_method  string default 'cash'
  //   rooms           array  [{room_id: UUID}] — falls back to booking_request.room_id
  fastify.post('/confirm-request', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['request_id', 'customer_id'],
        properties: {
          request_id:     { type: 'string' },
          customer_id:    { type: 'string' },
          total_amount:   { type: 'number', default: 0 },
          balance_due:    { type: 'number' },
          deposit_amount: { type: 'number', default: 0 },
          payment_method: { type: 'string', default: 'cash' },
          rooms: {
            type: 'array',
            items: { type: 'object', properties: { room_id: { type: 'string' } } },
          },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      request_id,
      customer_id,
      total_amount   = 0,
      deposit_amount = 0,
      payment_method = 'cash',
      rooms          = [],
    } = request.body;

    const balance_due = request.body.balance_due != null
      ? request.body.balance_due
      : Math.max(0, total_amount - deposit_amount);

    assertUUID(request_id,  'request_id');
    assertUUID(customer_id, 'customer_id');

    return withTenantContext(tenantId, async (client) => {
      // Step 1 — Load the booking_request (source of truth for dates/times/room)
      const { rows: [req] } = await client.query(
        `SELECT id, room_id,
                COALESCE(requested_date, date_from)::date AS booking_date,
                COALESCE(date_from, requested_date)::date AS date_from,
                COALESCE(date_to,   requested_date)::date AS date_to,
                start_time, end_time
         FROM   bookings.booking_requests
         WHERE  id = $1::uuid AND tenant_id = $2`,
        [request_id, tenantId]
      );

      if (!req) throw notFound('BookingRequest', request_id);

      // Step 2 — Resolve room list; fall back to the request's primary room
      const roomIds = (Array.isArray(rooms) && rooms.length > 0)
        ? rooms.map(r => r.room_id)
        : [req.room_id];

      const count          = roomIds.length;
      // Distribute total evenly across rooms (round to 2 dp)
      const perRoomTotal   = Math.round((total_amount / count) * 100) / 100;
      const perRoomBalance = Math.round((balance_due  / count) * 100) / 100;

      // Step 3 — Insert one confirmed_booking per room
      const bookingIds = [];
      for (const roomId of roomIds) {
        assertUUID(roomId, 'rooms[].room_id');
        const { rows: [bk] } = await client.query(
          `INSERT INTO bookings.confirmed_bookings
             (tenant_id, customer_id, room_id,
              booking_date, date_from, date_to,
              start_time, end_time,
              total_amount, deposit_paid, balance_due, status)
           VALUES ($1, $2::uuid, $3::uuid,
                   $4::date, $5::date, $6::date,
                   $7::time, $8::time,
                   $9, $10, $11, 'deposit_pending')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            tenantId, customer_id, roomId,
            req.booking_date, req.date_from, req.date_to,
            req.start_time,   req.end_time,
            perRoomTotal, deposit_amount, perRoomBalance,
          ]
        );
        if (bk) bookingIds.push(bk.id);
      }

      if (bookingIds.length === 0) {
        throw conflict('Booking', 'all room slots already booked (ON CONFLICT DO NOTHING)');
      }

      // Step 4 — Record deposit against the first created booking
      // (skip card — Stripe webhook owns it; otherwise we duplicate)
      if (deposit_amount > 0 && payment_method !== 'card') {
        await client.query(
          `INSERT INTO bookings.payments
             (booking_id, customer_id, amount, payment_type, payment_method,
              status, tenant_id, reference_number)
           VALUES ($1::uuid, $2::uuid, $3::numeric, 'deposit', $4,
                   'received', $5,
                   'DEP-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MISS') || '-' || UPPER(LEFT(MD5(RANDOM()::text), 4)))`,
          [bookingIds[0], customer_id, deposit_amount, payment_method, tenantId]
        );
      }

      // Step 5 — Close the booking_request + mark customer booked
      await client.query(
        `UPDATE bookings.booking_requests
         SET    status = 'booked'
         WHERE  id = $1::uuid AND tenant_id = $2`,
        [request_id, tenantId]
      );

      await client.query(
        `UPDATE bookings.customers
         SET    status = 'booked', updated_at = NOW()
         WHERE  id = $1::uuid AND tenant_id = $2`,
        [customer_id, tenantId]
      );

      // Step 6 — Log interaction
      // Build subject string in JS (Pattern 3: no $N reuse in mixed type contexts)
      const roomLookup = await client.query(
        `SELECT name FROM bookings.rooms WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
        [roomIds[0], tenantId]
      );
      const roomName    = roomLookup.rows[0]?.name ?? '';
      const bookingDate = req.booking_date ? String(req.booking_date).slice(0, 10) : '';
      const subject     = `Booking confirmed: ${roomName} | ${bookingDate}`;

      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, booking_id,
            subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2::uuid, $3::uuid,
                 $4, 'booking_confirmed',
                 'New booking created and confirmed via VenueDesk API',
                 'VenueDesk API', NOW())`,
        [tenantId, customer_id, bookingIds[0], subject]
      );

      await logger.info(
        'BookingsRoute',
        `Booking confirmed from request: ${request_id}`,
        { request_id, booking_ids: bookingIds, customer_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: { booking_ids: bookingIds, request_id } };
    });
  });


  // ─── POST /bookings/update ────────────────────────────────────────────────
  // Partial update of a confirmed booking's mutable fields.
  // At least one optional field must be supplied.
  //
  // Body:
  //   booking_id   UUID    required
  //   status       string  optional
  //   total_amount number  optional
  //   balance_due  number  optional
  //   notes        string  optional
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['booking_id'],
        properties: {
          booking_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['confirmed', 'pending', 'provisional', 'deposit_paid',
                   'cancelled', 'fully_paid', 'paid', 'overridden'],
          },
          total_amount: { type: 'number' },
          balance_due:  { type: 'number' },
          notes:        { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { booking_id, status, total_amount, balance_due, notes } = request.body;

    assertUUID(booking_id, 'booking_id');

    if (status == null && total_amount == null && balance_due == null && notes == null) {
      throw unprocessable('At least one field (status, total_amount, balance_due, notes) must be provided');
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE bookings.confirmed_bookings
         SET
           status       = COALESCE($3,          status),
           total_amount = COALESCE($4::numeric,  total_amount),
           balance_due  = COALESCE($5::numeric,  balance_due),
           notes        = COALESCE($6,           notes),
           updated_at   = NOW()
         WHERE id        = $1::uuid
           AND tenant_id = $2
         RETURNING id, status, total_amount, balance_due, updated_at`,
        [
          booking_id, tenantId,
          status       ?? null,
          total_amount != null ? String(total_amount) : null,
          balance_due  != null ? String(balance_due)  : null,
          notes        ?? null,
        ]
      );

      if (!rows.length) throw notFound('Booking', booking_id);

      await logger.info(
        'BookingsRoute',
        `Booking updated: ${booking_id}`,
        { booking_id, tenant_id: tenantId, fields: { status, total_amount, balance_due } },
        tenantId
      );

      // Log interaction — replaces DB: Log Confirm Interaction (Upd) in 7ZXOI73BhHLXkyOc
      // Build strings in JS (Pattern 3: avoid $N reuse across type contexts)
      const updatedFields = [
        status       != null && 'status',
        total_amount != null && 'total_amount',
        balance_due  != null && 'balance_due',
        notes        != null && 'notes',
      ].filter(Boolean).join(', ') || 'no changes';
      const updateSubject = `Booking status updated: ${status || rows[0].status}`;
      const updateNotes   = `Fields updated: ${updatedFields}`;

      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, booking_id,
            subject, interaction_type, notes, staff_member, timestamp)
         SELECT $1, cb.customer_id, cb.id,
                $3, 'booking_updated', $4,
                'VenueDesk API', NOW()
         FROM   bookings.confirmed_bookings cb
         WHERE  cb.id = $2::uuid AND cb.tenant_id = $1`,
        [tenantId, booking_id, updateSubject, updateNotes]
      ).catch(() => { /* non-fatal — log failure must not roll back the update */ });

      return { success: true, data: rows[0] };
    });
  });


  // ─── POST /bookings/cancel ────────────────────────────────────────────────
  // Replaces:
  //   AGkUe3zjjFDD0wOL  (single booking cancel → bookings.cancellations)
  //   CancelRecurringSeries (series deactivation + future session cancel)
  //
  // Mode is inferred from the presence of `series_id`:
  //   series_id present  → recurring series cancel
  //   booking_id present → single booking cancel
  //
  // Body:
  //   booking_id     UUID   required for single booking mode
  //   series_id      UUID   required for recurring series mode
  //   cancelled_by   string required
  //   reason         string optional
  //   refund_amount  number default 0
  //   refund_type    string optional  e.g. 'full' | 'partial' | 'none'
  fastify.post('/cancel', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['cancelled_by'],
        properties: {
          booking_id:    { type: 'string' },
          series_id:     { type: 'string' },
          cancelled_by:  { type: 'string' },
          reason:        { type: 'string', default: '' },
          refund_amount: { type: 'number', default: 0 },
          refund_type:   { type: 'string', default: 'none' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      booking_id,
      series_id,
      cancelled_by,
      reason        = '',
      refund_amount = 0,
      refund_type   = 'none',
    } = request.body;

    if (!booking_id && !series_id) {
      throw unprocessable('Either booking_id or series_id is required');
    }

    // ── Recurring series cancel ─────────────────────────────────────────────
    if (series_id) {
      assertUUID(series_id, 'series_id');

      return withTenantContext(tenantId, async (client) => {
        // Step 1 — Deactivate series (mirrors DB: Deactivate Series)
        const { rows: seriesRows } = await client.query(
          `UPDATE bookings.recurring_series
           SET    active     = false,
                  updated_at = NOW()
           WHERE  id         = $1::uuid
             AND  tenant_id  = $2::integer
           RETURNING id, series_name, balance_due, customer_id`,
          [series_id, tenantId]
        );

        if (!seriesRows.length) throw notFound('RecurringSeries', series_id);

        const series = seriesRows[0];

        // Step 2 — Cancel all future sessions (mirrors DB: Cancel Future Sessions)
        const { rows: cancelledSessions } = await client.query(
          `UPDATE bookings.confirmed_bookings
           SET    status     = 'cancelled',
                  updated_at = NOW()
           WHERE  (recurring_series_id = $1::uuid OR recurring_rule_id = $1::uuid)
             AND  tenant_id  = $2::integer
             AND  COALESCE(booking_date, date_from) >= CURRENT_DATE
             AND  status    != 'cancelled'
           RETURNING id, COALESCE(booking_date, date_from) AS session_date`,
          [series_id, tenantId]
        );

        // Step 3 — Log interaction
        await client.query(
          `INSERT INTO bookings.customer_interactions
             (tenant_id, customer_id, subject, interaction_type, notes, staff_member, timestamp)
           VALUES ($1, $2, $3, 'booking_cancelled', $4, 'VenueDesk API', NOW())`,
          [
            tenantId,
            series.customer_id,
            `Recurring series cancelled: ${series.series_name}`,
            `${cancelledSessions.length} future sessions cancelled. Reason: ${reason || 'not specified'}. Cancelled by: ${cancelled_by}`,
          ]
        );

        await logger.info(
          'BookingsRoute',
          `Recurring series cancelled: ${series_id}`,
          { series_id, sessions_cancelled: cancelledSessions.length, tenant_id: tenantId },
          tenantId
        );

        return {
          success: true,
          data: {
            series_id,
            series_name:        series.series_name,
            sessions_cancelled: cancelledSessions.length,
            session_dates:      cancelledSessions.map(r => r.session_date),
          },
        };
      });
    }

    // ── Single booking cancel ───────────────────────────────────────────────
    assertUUID(booking_id, 'booking_id');

    return withTenantContext(tenantId, async (client) => {
      // Step 1 — Load booking + customer + room (mirrors DB: Get Booking)
      const { rows: [booking] } = await client.query(
        `SELECT cb.id, cb.customer_id, cb.room_id,
                r.name   AS room_name,
                cb.booking_date, cb.date_from, cb.date_to,
                cb.start_time, cb.end_time,
                cb.total_amount, cb.deposit_paid, cb.balance_due,
                cb.status, cb.tenant_id,
                cb.recurring_series_id, cb.recurring_rule_id, cb.is_recurring,
                c.full_name AS customer_name, c.email AS customer_email
         FROM   bookings.confirmed_bookings cb
         LEFT JOIN bookings.customers c ON c.id = cb.customer_id
         LEFT JOIN bookings.rooms     r ON r.id = cb.room_id
         WHERE  cb.id = $1::uuid AND cb.tenant_id = $2
         LIMIT  1`,
        [booking_id, tenantId]
      );

      if (!booking) throw notFound('Booking', booking_id);

      if (booking.status === 'cancelled') {
        throw conflict('Booking', 'already cancelled');
      }

      // Step 2 — Move booking to cancellations + delete from confirmed_bookings
      // (mirrors DB: Cancel Booking — DELETE + INSERT INTO cancellations)
      const { rows: [cancellation] } = await client.query(
        `WITH deleted AS (
           DELETE FROM bookings.confirmed_bookings
           WHERE  id = $1::uuid AND tenant_id = $2::integer
           RETURNING
             id, tenant_id, customer_id, room_id,
             booking_date, date_from, date_to, start_time, end_time,
             total_amount, deposit_paid, balance_due,
             recurring_series_id, recurring_rule_id, is_recurring, status
         )
         INSERT INTO bookings.cancellations (
           tenant_id, original_booking_id, customer_id, room_id,
           booking_date, date_from, date_to, start_time, end_time,
           total_amount, deposit_paid, balance_due,
           series_reference,
           recurring_series_id, recurring_rule_id, is_recurring,
           reason, cancelled_by, original_status, cancelled_at
         )
         SELECT
           d.tenant_id, d.id, d.customer_id, d.room_id,
           d.booking_date, d.date_from, d.date_to, d.start_time, d.end_time,
           d.total_amount, d.deposit_paid, d.balance_due,
           COALESCE(
             (SELECT rs.series_name FROM bookings.recurring_series rs
              WHERE rs.id = d.recurring_series_id LIMIT 1),
             (SELECT rr.series_reference FROM bookings.recurring_rules rr
              WHERE rr.id = d.recurring_rule_id LIMIT 1)
           ),
           d.recurring_series_id, d.recurring_rule_id, d.is_recurring,
           $3, $4, d.status, NOW()
         FROM deleted d
         RETURNING
           id::text            AS cancellation_id,
           original_booking_id::text AS booking_id,
           series_reference,
           cancelled_at::text`,
        [booking_id, tenantId, reason, cancelled_by]
      );

      // Step 3 — Record refund payment (mirrors DB: Record Cancellation)
      if (refund_amount > 0 || refund_type !== 'none') {
        await client.query(
          `INSERT INTO bookings.payments
             (booking_id, customer_id, payment_type, amount, payment_method, status,
              reference_number, cancellation_booking_ref, cancellation_reason,
              refund_type, tenant_id, payment_date)
           VALUES
             ($1::uuid, $2::uuid, 'refund', -($3::numeric), 'refund',
              CASE WHEN ($3::numeric) > 0 THEN 'refunded' ELSE 'received' END,
              'REF-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MI') || '-' || LEFT(gen_random_uuid()::text, 8),
              $4, $5, $6, $7, NOW())`,
          [
            booking.id,
            booking.customer_id,
            refund_amount,
            booking_id,
            reason,
            refund_type,
            tenantId,
          ]
        );
      }

      // Step 4 — Log interaction (mirrors DB: Log Cancel Interaction)
      // NOTE: $1..$8 used contiguously. Earlier revision had a stale
      // booking.booking_date at position 7 that the SQL never referenced —
      // PostgreSQL responded with "could not determine data type of parameter $7"
      // because unused params can't be type-inferred. The booking_date interpolation
      // moved into the subject string below, where it belongs.
      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, customer_name, customer_email,
            booking_id, room_name, subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6,
                 $7,
                 'booking_cancelled',
                 $8,
                 'VenueDesk API', NOW())`,
        [
          tenantId,
          booking.customer_id,
          booking.customer_name,
          booking.customer_email ?? '',
          booking.id,
          booking.room_name ?? '',
          `Booking cancelled: ${booking.room_name ?? ''} | ${booking.booking_date ?? ''}`,
          `Reason: ${reason || 'not specified'}. Cancelled by: ${cancelled_by}${refund_amount > 0 ? `. Refund: £${refund_amount} (${refund_type})` : ''}`,
        ]
      );

      await logger.info(
        'BookingsRoute',
        `Booking cancelled: ${booking_id}`,
        { booking_id, cancellation_id: cancellation.cancellation_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: cancellation };
    });
  });


  // ─── POST /bookings/cancel-pending ───────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Cancel Request + DB: Cancel Customer
  //           (the cancel-pending webhook path — kills a pre-confirmation request)
  //
  // This is distinct from POST /bookings/cancel which handles confirmed bookings.
  // cancel-pending closes an open booking_request and marks the customer cancelled
  // before any confirmed_booking has been created.
  //
  // Body:
  //   customer_id   UUID — required
  //
  // tenant_id is taken from JWT — never from the body.
  fastify.post('/cancel-pending', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id'],
        properties: {
          customer_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId  = request.user.tenant_id;
    const { customer_id } = request.body;

    assertUUID(customer_id, 'customer_id');

    return withTenantContext(tenantId, async (client) => {
      // Step 1 — Cancel all open booking_requests for this customer
      // (mirrors DB: Cancel Request)
      const { rowCount: reqCount } = await client.query(
        `UPDATE bookings.booking_requests
         SET    status = 'cancelled'
         WHERE  customer_id = $1::uuid
           AND  tenant_id   = $2
           AND  status NOT IN ('booked', 'cancelled', 'completed')`,
        [customer_id, tenantId]
      );

      // Step 2 — Mark customer cancelled
      // (mirrors DB: Cancel Customer)
      const { rowCount: custCount, rows } = await client.query(
        `UPDATE bookings.customers
         SET    status     = 'cancelled',
                updated_at = NOW()
         WHERE  id         = $1::uuid
           AND  tenant_id  = $2
         RETURNING id, status, updated_at`,
        [customer_id, tenantId]
      );

      if (custCount === 0) throw notFound('Customer', customer_id);

      // Step 3 — Log interaction (non-fatal)
      const cancelSubject = `Pending request cancelled for customer: ${customer_id}`;
      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2::uuid, $3, 'booking_cancelled', $4, 'VenueDesk API', NOW())`,
        [
          tenantId,
          customer_id,
          cancelSubject,
          `${reqCount} booking request(s) cancelled`,
        ]
      ).catch(() => { /* non-fatal */ });

      await logger.info(
        'BookingsRoute',
        `Pending request cancelled: customer ${customer_id}`,
        { customer_id, requests_cancelled: reqCount, tenant_id: tenantId },
        tenantId
      );

      return {
        success: true,
        data: {
          customer:           rows[0],
          requests_cancelled: reqCount,
        },
      };
    });
  });


  // ─── GET /bookings/list ───────────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Bookings (all-bookings webhook path)
  //
  // Returns all confirmed bookings for the tenant ordered by date ASC,
  // with customer and room details joined, and recurring flags resolved.
  fastify.get('/list', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           cb.id,
           cb.customer_id,
           cb.booking_date,
           cb.date_from,
           cb.date_to,
           cb.start_time,
           cb.end_time,
           cb.total_amount,
           cb.balance_due,
           cb.payment_method,
           cb.status,
           COALESCE(cb.guest_count, c.guests_count) AS guest_count,
           c.full_name   AS customer_name,
           c.email       AS customer_email,
           c.phone       AS customer_phone,
           c.notes,
           r.name        AS room_name,
           COALESCE(cb.recurring_series_id, cb.recurring_rule_id)::text AS recurring_series_id,
           cb.recurring_rule_id::text AS recurring_rule_id,
           CASE
             WHEN cb.recurring_series_id IS NOT NULL THEN true
             WHEN cb.recurring_rule_id   IS NOT NULL THEN true
             WHEN COALESCE(cb.is_recurring, false)   THEN true
             ELSE false
           END AS is_recurring
         FROM bookings.confirmed_bookings cb
         JOIN bookings.customers c ON cb.customer_id = c.id
         JOIN bookings.rooms     r ON cb.room_id     = r.id
         WHERE c.tenant_id = $1::integer
         ORDER BY COALESCE(cb.date_from, cb.booking_date) ASC`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });


  // ─── GET /bookings/pending ────────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Pending (get-pending-requests webhook path)
  //
  // Returns all open booking_requests (pending/contacted customers, not yet
  // booked/cancelled/completed) ordered by requested date ASC.
  fastify.get('/pending', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           br.id AS request_id,
           c.id  AS customer_id,
           c.full_name,
           c.email,
           c.phone,
           r.name AS room_name,
           r.id   AS room_id,
           br.requested_date,
           br.date_from,
           br.date_to,
           br.start_time,
           br.end_time,
           br.estimated_cost,
           c.notes,
           COALESCE(br.guest_count, c.guests_count) AS guest_count,
           c.event_type,
           c.created_at,
           COALESCE(c.warning_sent, false) AS warning_sent,
           CASE WHEN EXISTS(
             SELECT 1 FROM bookings.confirmed_bookings cb2
             WHERE cb2.customer_id = c.id AND cb2.status != 'cancelled'
           ) THEN true ELSE false END AS has_booking
         FROM bookings.booking_requests br
         JOIN bookings.customers c ON br.customer_id = c.id
         JOIN bookings.rooms     r ON br.room_id     = r.id
         WHERE c.status IN ('pending', 'contacted')
           AND br.status NOT IN ('booked', 'cancelled', 'completed')
           AND c.tenant_id = $1::integer
         ORDER BY COALESCE(br.date_from, br.requested_date) ASC`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });


  // ─── POST /bookings/get-room ──────────────────────────────────────────────
  // Replaces: eI6PSBE1TbpaRx9K → DB: Get Room
  // Validates room against the tenant and returns rate data.
  // Accepts room_id OR room_name — callers vary (n8n upstream sometimes sends
  // room_name only when room_id resolution races). 422 only if neither provided.
  fastify.post('/get-room', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          room_id:   { type: ['string', 'null'] },
          room_name: { type: ['string', 'null'] },
          jwt:       { type: 'string' },   // Pattern 4: body-tunnelled token (consumed by auth)
        },
        additionalProperties: true,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const room_id   = (request.body.room_id   && String(request.body.room_id).trim())   || null;
    const room_name = (request.body.room_name && String(request.body.room_name).trim()) || null;

    if (!room_id && !room_name) {
      throw unprocessable('Either room_id or room_name is required');
    }

    // Prefer UUID lookup when present; fall back to name. Both filtered by tenant.
    const { rows } = room_id
      ? await systemQuery(
          `SELECT id, name, day_rate, half_rate
           FROM   bookings.rooms
           WHERE  id        = $1::uuid
             AND  tenant_id = $2::integer
           LIMIT  1`,
          [room_id, tenantId]
        )
      : await systemQuery(
          `SELECT id, name, day_rate, half_rate
           FROM   bookings.rooms
           WHERE  lower(name) = lower($1)
             AND  tenant_id   = $2::integer
           LIMIT  1`,
          [room_name, tenantId]
        );

    if (!rows.length) throw notFound('Room', room_id || room_name);
    return { success: true, data: rows[0] };
  });


  // ─── POST /bookings/clash-guard ───────────────────────────────────────────
  // Replaces: eI6PSBE1TbpaRx9K → DB: Clash Guard
  // Checks confirmed_bookings AND recurring_rules for the requested slot.
  // Returns { clashes: number } — n8n IF node gates on clashes === 0.
  //
  // Body:
  //   room_id      UUID   required
  //   booking_date date   required (ISO)
  //   start_time   string required (HH:MM)
  //   end_time     string required (HH:MM)
  //   date_to      date   optional (defaults to booking_date for multi-day events)
  fastify.post('/clash-guard', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['room_id', 'booking_date', 'start_time', 'end_time'],
        properties: {
          room_id:      { type: 'string' },
          booking_date: { type: 'string' },
          start_time:   { type: 'string' },
          end_time:     { type: 'string' },
          date_to:      { type: 'string' },
          jwt:          { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { room_id, booking_date, start_time, end_time } = request.body;
    const date_to = request.body.date_to || booking_date;

    assertUUID(room_id, 'room_id');

    // Replicates DB: Clash Guard verbatim — buffer pulled from settings at runtime.
    // $1=room_id, $2=booking_date, $3=start_time, $4=end_time, $5=date_to, $6=tenantId
    const { rows } = await systemQuery(
      `SELECT COUNT(*) AS clashes
       FROM (
         SELECT id
         FROM   bookings.confirmed_bookings
         WHERE  room_id    = $1::uuid
           AND  tenant_id  = $6::integer
           AND  status     NOT IN ('cancelled')
           AND  $2::date  <= COALESCE(date_to::date,   booking_date)
           AND  $5::date  >= COALESCE(date_from::date, booking_date)
           AND  start_time <  ($4::time + (COALESCE(
                 (SELECT value::int FROM bookings.settings WHERE key = 'booking_buffer_minutes'),
                 60) || ' minutes')::interval)
           AND  end_time   >  ($3::time - (COALESCE(
                 (SELECT value::int FROM bookings.settings WHERE key = 'booking_buffer_minutes'),
                 60) || ' minutes')::interval)

         UNION ALL

         SELECT rr.id
         FROM   bookings.recurring_rules rr
         CROSS JOIN LATERAL generate_series($2::date, $5::date, '1 day'::interval) AS gs(d)
         WHERE  rr.room_id    = $1::uuid
           AND  rr.tenant_id  = $6::integer
           AND  rr.active     = TRUE
           AND  EXTRACT(DOW FROM gs.d)::int = rr.day_of_week
           AND  rr.start_time <  ($4::time + (COALESCE(
                 (SELECT value::int FROM bookings.settings WHERE key = 'booking_buffer_minutes'),
                 60) || ' minutes')::interval)
           AND  rr.end_time   >  ($3::time - (COALESCE(
                 (SELECT value::int FROM bookings.settings WHERE key = 'booking_buffer_minutes'),
                 60) || ' minutes')::interval)
           AND  (rr.end_date IS NULL OR rr.end_date >= $2::date)
       ) all_clashes`,
      [room_id, booking_date, start_time, end_time, date_to, tenantId]
    );

    return { success: true, data: { clashes: parseInt(rows[0].clashes, 10) } };
  });


  // ─── POST /bookings/make-booking ──────────────────────────────────────────
  // Replaces: eI6PSBE1TbpaRx9K →
  //   DB: Create Booking  (INSERT confirmed_bookings)
  //   DB: Record Payment  (INSERT payments — skipped if payment_type_clean = 'none')
  //   DB: Close Request   (UPDATE booking_requests + customers — non-fatal, request_id optional)
  //
  // Clash guard is the caller's responsibility (clash-guard endpoint + IF node upstream).
  //
  // Body (all values pre-computed by Code: Logic + Ref):
  //   customer_id, room_id, booking_date, start_time, end_time  — required
  //   total_amount, balance_due, booking_status                  — required
  //   payment_amount, payment_type_clean, payment_method         — optional
  //   payment_date, txn_reference                                — optional
  //   request_id, date_from, date_to, guest_count               — optional
  fastify.post('/make-booking', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: [
          'customer_id', 'room_id', 'booking_date', 'start_time', 'end_time',
          'total_amount', 'balance_due', 'booking_status',
        ],
        properties: {
          customer_id:        { type: 'string' },
          room_id:            { type: 'string' },
          booking_date:       { type: 'string' },
          start_time:         { type: 'string' },
          end_time:           { type: 'string' },
          date_from:          { type: 'string' },
          date_to:            { type: 'string' },
          total_amount:       { type: 'number' },
          payment_amount:     { type: 'number', default: 0 },
          balance_due:        { type: 'number' },
          booking_status:     { type: 'string' },
          payment_type_clean: { type: 'string', default: 'none' },
          payment_method:     { type: 'string', default: 'cash' },
          payment_date:       { type: 'string' },
          txn_reference:      { type: 'string' },
          request_id:         { anyOf: [{ type: 'string' }, { type: 'null' }] },
          guest_count:        { anyOf: [{ type: 'number' }, { type: 'null' }] },
          jwt:                { type: 'string' },
        },
        additionalProperties: true,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      booking_date,
      start_time,
      end_time,
      total_amount,
      payment_amount     = 0,
      balance_due,
      booking_status,
      payment_type_clean = 'none',
      payment_method     = 'cash',
      payment_date,
      txn_reference,
      request_id,
      date_from          = booking_date,
      date_to            = booking_date,
      guest_count        = null,
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');
    if (request_id) assertUUID(request_id, 'request_id');

    // deposit_paid_date: set only when a real payment is recorded (Pattern 3: built in JS)
    const depositPaidDate = (payment_type_clean !== 'none' && payment_amount > 0)
      ? (payment_date || new Date().toISOString())
      : null;

    return withTenantContext(tenantId, async (client) => {

      // ── Insert confirmed_booking ──────────────────────────────────────────
      const { rows: [booking] } = await client.query(
        `INSERT INTO bookings.confirmed_bookings
           (tenant_id, customer_id, room_id,
            booking_date, date_from, date_to,
            start_time, end_time,
            total_amount, deposit_paid, deposit_paid_date, balance_due,
            status, guest_count, payment_method, booking_request_id)
         VALUES ($1, $2::uuid, $3::uuid,
                 $4::date, $5::date, $6::date,
                 $7::time, $8::time,
                 $9, $10, $11, $12,
                 $13, $14, $15, $16)
         RETURNING id, booking_date, start_time, end_time,
                   total_amount, deposit_paid, balance_due, status`,
        [
          tenantId, customer_id, room_id,
          booking_date, date_from, date_to,
          start_time, end_time,
          total_amount, payment_amount, depositPaidDate, balance_due,
          booking_status, guest_count, payment_method,
          request_id || null,
        ]
      );

      // ── Record payment (skip for pending / zero-amount / card bookings) ──
      // Skip card payments — the Stripe webhook (stripe.js) owns that row.
      // If we INSERT here too, we get a TXN-* duplicate and the SUM-recompute
      // double-counts the deposit. Card payments only land via the webhook,
      // which is idempotent (ON CONFLICT DO NOTHING + SELECT FROM cb).
      if (
        payment_type_clean !== 'none' &&
        payment_amount > 0 &&
        payment_method !== 'card'
      ) {
        await client.query(
          `INSERT INTO bookings.payments
             (customer_id, booking_id, payment_type, amount, payment_method,
              status, reference_number, tenant_id)
           VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5,
                   'received', $6, $7)`,
          [
            customer_id, booking.id,
            payment_type_clean, payment_amount, payment_method,
            txn_reference || `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
            tenantId,
          ]
        );
      }

      // ── Close booking_request (non-fatal, only when request_id present) ─────
      if (request_id) {
        await client.query(
          `UPDATE bookings.booking_requests
           SET    status = 'booked'
           WHERE  id        = $1::uuid
             AND  tenant_id = $2`,
          [request_id, tenantId]
        ).catch(() => { /* non-fatal — request may already be closed */ });
      }

      // ── Update customer status — always, including walk-in bookings ──────────
      // customers.status only accepts: 'pending' | 'contacted' | 'booked' | 'cancelled'
      // Map booking_status → customer status
      const customerStatus = booking_status === 'pending' ? 'pending' : 'booked';
      await client.query(
        `UPDATE bookings.customers
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2::uuid
           AND  tenant_id  = $3`,
        [customerStatus, customer_id, tenantId]
      ).catch(() => { /* non-fatal */ });

      await logger.info(
        'BookingsRoute',
        `Booking created via make-booking: ${booking.id}`,
        { booking_id: booking.id, customer_id, room_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: { ...booking, txn_reference: txn_reference || null } };
    });
  });


  // ─── POST /bookings/check-availability ───────────────────────────────────
  // Replaces: eI6PSBE1TbpaRx9K → DB: Check Clashes (check-availability webhook path)
  //
  // Called by the public enquiry form via n8n. Looks up room by name (not UUID).
  //
  // Phase 2 exception: accepts tenant_id from body — this is a read-only endpoint
  // called by unauthenticated visitors who have no JWT. No write risk.
  // Phase 3 action: migrate n8n to pass a service-account JWT instead.
  //
  // Body: roomName, eventDate, timeFrom, timeTo, dateTo, tenant_id
  fastify.post('/check-availability', {
    // No fastify.authenticate — public enquiry form path
    schema: {
      body: {
        type: 'object',
        required: ['roomName', 'eventDate', 'timeFrom', 'timeTo', 'tenant_id'],
        properties: {
          roomName:  { type: 'string' },
          eventDate: { type: 'string' },
          timeFrom:  { type: 'string' },
          timeTo:    { type: 'string' },
          dateTo:    { type: 'string' },
          tenant_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        },
        additionalProperties: true,
      },
    },
  }, async (request) => {
    const { roomName, eventDate, timeFrom, timeTo } = request.body;
    const dateTo   = request.body.dateTo || eventDate;
    const tenantId = parseInt(request.body.tenant_id || '0', 10);

    if (!tenantId) throw unprocessable('tenant_id is required');

    // Display-only availability check — direct overlap only, NO turnaround buffer.
    // The 60-min buffer is enforced at booking submission time by clash-guard.
    // Using no buffer here gives the user honest "Available / Not available" feedback
    // without blocking slots that are genuinely free but adjacent to a recurring rule.
    // $1=roomName, $2=eventDate, $3=timeFrom, $4=timeTo, $5=dateTo, $6=tenantId
    const { rows } = await systemQuery(
      `SELECT
         CASE WHEN COUNT(*) = 0 THEN true ELSE false END AS available,
         COUNT(*) AS clash_count,
         60 AS buffer_minutes
       FROM (
         SELECT cb.id::text AS clash_source
         FROM   bookings.confirmed_bookings cb
         JOIN   bookings.rooms r ON cb.room_id = r.id
         WHERE  r.name     ILIKE $1
           AND  cb.tenant_id    = $6::integer
           AND  cb.status      NOT IN ('cancelled')
           AND  $2::date       <= COALESCE(cb.date_to::date,   cb.booking_date)
           AND  $5::date       >= COALESCE(cb.date_from::date, cb.booking_date)
           AND  cb.start_time  <  $4::time
           AND  cb.end_time    >  $3::time

         UNION ALL

         SELECT rr.id::text AS clash_source
         FROM   bookings.recurring_rules rr
         JOIN   bookings.rooms r ON rr.room_id = r.id
         CROSS JOIN LATERAL generate_series($2::date, $5::date, '1 day'::interval) AS gs(d)
         WHERE  r.name     ILIKE $1
           AND  rr.tenant_id    = $6::integer
           AND  rr.active       = TRUE
           AND  EXTRACT(DOW FROM gs.d)::int = rr.day_of_week
           AND  rr.start_time  <  $4::time
           AND  rr.end_time    >  $3::time
           AND  (rr.end_date IS NULL OR rr.end_date >= $2::date)
       ) clashes`,
      [roomName, eventDate, timeFrom, timeTo, dateTo, tenantId]
    );

    const row = rows[0];
    return {
      available:      row.available,
      clash_count:    parseInt(row.clash_count,    10),
      buffer_minutes: parseInt(row.buffer_minutes, 10),
    };
  });

  // ─── POST /bookings/create-request ────────────────────────────────────────
  // INSERT INTO bookings.booking_requests — replaces K3oWOutGQuE9HWfm (Main System
  // Workflow) DB: Create Request1 Postgres node. Called after customer upsert
  // when a new enquiry arrives via the public enquiry form.
  //
  // Body: { customer_id, room_id, event_date, date_from?, date_to?,
  //         start_time, end_time, guest_count?, estimated_cost? }
  fastify.post('/create-request', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'room_id', 'event_date', 'start_time', 'end_time'],
        properties: {
          customer_id:    { type: 'string' },
          room_id:        { type: 'string' },
          event_date:     { type: 'string' },
          date_from:      { type: 'string', nullable: true },
          date_to:        { type: 'string', nullable: true },
          start_time:     { type: 'string' },
          end_time:       { type: 'string' },
          guest_count:    { type: 'integer', default: 0 },
          estimated_cost: { type: 'number',  default: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      room_id,
      event_date,
      date_from      = null,
      date_to        = null,
      start_time,
      end_time,
      guest_count    = 0,
      estimated_cost = 0,
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    assertUUID(room_id,     'room_id');

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.booking_requests
           (customer_id, room_id, requested_date, date_from, date_to,
            start_time, end_time, guest_count, status, estimated_cost, tenant_id)
         VALUES (
           $1::uuid, $2::uuid, $3::date,
           COALESCE($4::date, $3::date),
           COALESCE($5::date, $4::date, $3::date),
           $6::time, $7::time,
           $8::integer,
           'pending_review',
           $9::numeric,
           $10::integer
         )
         RETURNING id`,
        [
          customer_id, room_id, event_date,
          date_from || null, date_to || null,
          start_time, end_time,
          guest_count, estimated_cost, tenantId,
        ]
      );

      return { success: true, data: { id: rows[0].id } };
    });
  });

}

module.exports = customersRoutes;
