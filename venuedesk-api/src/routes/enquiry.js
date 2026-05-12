'use strict';

/**
 * enquiry.js — Public enquiry form endpoints
 *
 * Registered at /enquiry in server.js.
 *
 * Routes:
 *   POST /enquiry/create-request — public (no JWT); creates a booking_request from
 *                                   the public enquiry form.
 *
 * Security model:
 *   - No JWT required — this is a public-facing customer form.
 *   - tenant_id is validated server-side: must exist in bookings.tenants AND is_active=true.
 *     Returns 404 for both missing and inactive tenants (prevents enumeration).
 *   - All DB writes use withTenantContext (venuedesk_app role, RLS enforced).
 *   - Public can only INSERT into their own tenant — no cross-tenant SELECT possible.
 *   - Tenant context is set from the VALIDATED tenant row, never trusted directly
 *     from the request body.
 *
 * Returns:
 *   { success: true, booking_request_id: "<uuid>", customer_id: "<uuid>" }
 */

const { withTenantContext } = require('../db/pool');

module.exports = async function enquiryRoutes(fastify, _opts) {

  // ── POST /enquiry/create-request ────────────────────────────────────────────
  fastify.post('/create-request', async (req, reply) => {
    const rawTenantId = parseInt(req.body?.tenant_id || '0', 10);
    if (!rawTenantId) {
      return reply.code(400).send({ success: false, message: 'tenant_id required' });
    }

    // ── Destructure + sanitise input ─────────────────────────────────────────
    const {
      name, email, phone,
      room_name,
      event_type, hire_type,
      date_from, date_to, event_date,   // form sends both naming conventions
      start_time, end_time,
      guest_count, num_people,          // form sends both
      notes,
      total_cost,
    } = req.body || {};

    // Required field validation
    if (!name || !email || !phone) {
      return reply.code(400).send({ success: false, message: 'name, email and phone are required' });
    }
    if (!room_name) {
      return reply.code(400).send({ success: false, message: 'room_name is required' });
    }
    const resolvedDateFrom = date_from || event_date;
    const resolvedDateTo   = date_to   || event_date || resolvedDateFrom;
    if (!resolvedDateFrom || !start_time || !end_time) {
      return reply.code(400).send({ success: false, message: 'date, start_time and end_time are required' });
    }

    // Basic email format guard
    if (!email.includes('@')) {
      return reply.code(400).send({ success: false, message: 'Invalid email address' });
    }

    // ── Validate tenant exists + is active ───────────────────────────────────
    // Identical 404 for missing and inactive — prevents tenant enumeration.
    let validatedTenantId = null;
    try {
      const { rows } = await withTenantContext(rawTenantId, (client) =>
        client.query(
          `SELECT tenant_id FROM bookings.tenants
            WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1`,
          [rawTenantId]
        )
      );
      if (rows.length > 0) validatedTenantId = rows[0].tenant_id;
    } catch (_e) {
      validatedTenantId = null;
    }
    if (!validatedTenantId) return reply.code(404).send({});

    // ── All DB work in a single tenant context ───────────────────────────────
    try {
      const result = await withTenantContext(validatedTenantId, async (client) => {

        // 1. Upsert customer by (email, tenant_id)
        //    ON CONFLICT relies on the customers_email_tenant_uq constraint
        //    added by migration 017. Falls back to SELECT if constraint missing.
        const normalEmail = email.toLowerCase().trim().substring(0, 254);
        const guestCount  = Math.max(1, parseInt(guest_count || num_people || 1, 10));

        let customerId;
        try {
          const custRes = await client.query(
            `INSERT INTO bookings.customers
               (full_name, email, phone, event_type, guests_count, status, tenant_id)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6)
             ON CONFLICT (email, tenant_id) DO UPDATE
               SET full_name   = COALESCE(NULLIF(EXCLUDED.full_name,  ''), bookings.customers.full_name),
                   phone       = COALESCE(NULLIF(EXCLUDED.phone,       ''), bookings.customers.phone),
                   updated_at  = NOW()
             RETURNING id`,
            [
              name.trim().substring(0, 200),
              normalEmail,
              (phone || '').trim().substring(0, 50),
              (event_type || '').substring(0, 100),
              guestCount,
              validatedTenantId,
            ]
          );
          customerId = custRes.rows[0].id;
        } catch (_conflictErr) {
          // Constraint not yet present — fall back to SELECT or plain INSERT
          const existing = await client.query(
            'SELECT id FROM bookings.customers WHERE email = $1 AND tenant_id = $2 LIMIT 1',
            [normalEmail, validatedTenantId]
          );
          if (existing.rows.length > 0) {
            customerId = existing.rows[0].id;
          } else {
            const newCust = await client.query(
              `INSERT INTO bookings.customers
                 (full_name, email, phone, event_type, guests_count, status, tenant_id)
               VALUES ($1, $2, $3, $4, $5, 'pending', $6)
               RETURNING id`,
              [
                name.trim().substring(0, 200),
                normalEmail,
                (phone || '').trim().substring(0, 50),
                (event_type || '').substring(0, 100),
                guestCount,
                validatedTenantId,
              ]
            );
            customerId = newCust.rows[0].id;
          }
        }

        // 2. Lookup room_id by name (ILIKE — room names may differ in case)
        let roomId = null;
        const roomRes = await client.query(
          `SELECT id FROM bookings.rooms
            WHERE name ILIKE $1 AND tenant_id = $2 AND is_active = TRUE LIMIT 1`,
          [room_name, validatedTenantId]
        );
        if (roomRes.rows.length > 0) roomId = roomRes.rows[0].id;

        // 3. Insert booking_request with status 'pending_review'
        const costVal = total_cost ? parseFloat(total_cost) : null;
        const reqRes  = await client.query(
          `INSERT INTO bookings.booking_requests
             (customer_id, room_id, requested_date, date_from, date_to,
              start_time, end_time, guest_count, status,
              hire_type, total_cost, event_type, notes, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review',
                   $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            customerId,
            roomId,
            resolvedDateFrom,
            resolvedDateFrom,
            resolvedDateTo,
            start_time,
            end_time,
            guestCount,
            (hire_type || 'full_day'),
            costVal,
            (event_type || '').substring(0, 100),
            (notes || '').substring(0, 2000),
            validatedTenantId,
          ]
        );
        const bookingRequestId = reqRes.rows[0].id;

        // 4. Audit log (non-blocking inside same transaction)
        await client.query(
          `INSERT INTO bookings.audit_log
             (tenant_id, action, entity, entity_id, payload, staff_user, source)
           VALUES ($1, 'enquiry_submitted', 'booking_request', $2, $3, NULL, 'enquiry-form')`,
          [
            validatedTenantId,
            String(bookingRequestId),
            JSON.stringify({
              customer_id: customerId,
              room_name,
              date_from:   resolvedDateFrom,
              date_to:     resolvedDateTo,
              hire_type:   hire_type || 'full_day',
              total_cost:  costVal,
            }),
          ]
        );

        return { booking_request_id: bookingRequestId, customer_id: customerId };
      });

      return reply.send({ success: true, ...result });

    } catch (err) {
      fastify.log.error({ err }, '[enquiry] create-request failed');
      return reply.code(500).send({ success: false, message: 'Could not save enquiry — please try again' });
    }
  });
};
