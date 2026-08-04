'use strict';

const staffActor = req => req.user?.full_name || req.user?.name || req.user?.username || 'System';

/**
 * /customers routes — Phase 2 migration.
 * Replaces: UpdateCustomerWF (n8n Postgres nodes → API).
 *
 * All tenant_id values come exclusively from the verified JWT payload.
 * No tenant_id is accepted from the request body (CLAUDE.md §3.3).
 *
 * POST /customers/upsert            — find-or-create by email (booking intake)
 * POST /customers/update            — update fields on existing customer + log interaction
 * POST /customers/update-status     — update CRM status (pending → contacted → booked etc.)
 * GET  /customers/list              — all customers for tenant with latest booking dates
 * GET  /customers/interactions      — customer interaction log (by customer_id or email)
 * POST /customers/log-interaction   — create a customer_interactions row from the dashboard modal
 */

const { withTenantContext } = require('../db/pool');
const logger                = require('../services/LoggerService');
const { notFound, HttpError } = require('../utils/errors');
const {
  assertUUID,
  assertRequired,
  assertEmail,
  isUUID,
}                           = require('../utils/validators');

async function customersRoutes(fastify) {

  // ─── POST /customers/upsert ────────────────────────────────────────────────
  // Find-or-create customer by email (when email provided) or phone.
  // Called by the n8n make-booking workflow to resolve/create customer_id
  // before the booking record is inserted.
  //
  // Body: { full_name, email?, phone?, event_type?, notes?, source? }
  // Returns: { success, data: { id, full_name, email, phone, created } }
  //   created=true  → new customer inserted
  //   created=false → existing customer found and updated
  //
  // Conflict resolution:
  //   email present  → ON CONFLICT (email, tenant_id) DO UPDATE
  //   email absent   → ON CONFLICT (phone, tenant_id) DO UPDATE (phone must be present)
  fastify.post('/upsert', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['full_name'],
        properties: {
          full_name:  { type: 'string' },
          email:      { type: 'string' },
          phone:      { type: 'string' },
          event_type: { type: 'string' },
          notes:      { type: 'string' },
          source:     { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      full_name,
      email      = '',
      phone      = '',
      event_type = '',
      notes      = '',
      source     = 'booking_form',
    } = request.body;

    assertRequired(request.body, ['full_name']);
    if (email) assertEmail(email, 'email');
    if (!email && !phone) {
      throw new HttpError(400, 'Either email or phone is required for customer upsert.');
    }

    return withTenantContext(tenantId, async (client) => {
      let row, created;

      // ── SELECT-then-INSERT pattern ─────────────────────────────────────────
      // Avoids ON CONFLICT dependency on partial unique indexes.
      // Lookup priority: email (case-insensitive) → phone → insert new.
      //
      // Two-stage lookup needed because both `email` and `phone` columns carry
      // tenant-scoped UNIQUE constraints (idx_customers_email_tenant_uq AND
      // idx_customers_phone_tenant_uq). If we only checked email and missed,
      // the INSERT below could collide on phone and 500. Now we try email
      // first, then phone, then INSERT — guarantees an UPDATE path for any
      // existing row regardless of which key matches.
      let existing = [];
      if (email) {
        const r = await client.query(
          `SELECT id, full_name, email, phone FROM bookings.customers
           WHERE lower(email) = lower($2) AND tenant_id = $1 LIMIT 1`,
          [tenantId, email]
        );
        existing = r.rows;
      }
      if (existing.length === 0 && phone) {
        const r = await client.query(
          `SELECT id, full_name, email, phone FROM bookings.customers
           WHERE phone = $2 AND tenant_id = $1 LIMIT 1`,
          [tenantId, phone]
        );
        existing = r.rows;
      }

      if (existing.length > 0) {
        // ── Found — update name/phone if provided, return existing id ─────────
        const { rows: updated } = await client.query(
          `UPDATE bookings.customers
           SET full_name  = COALESCE(NULLIF($3,''), full_name),
               phone      = COALESCE(NULLIF($4,''), phone),
               event_type = COALESCE(NULLIF($5,''), event_type),
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, full_name, email, phone`,
          [existing[0].id, tenantId, full_name, phone, event_type]
        );
        row     = updated[0];
        created = false;
      } else {
        // ── Not found — insert new customer ───────────────────────────────────
        const cols = email
          ? `(tenant_id, full_name, email, phone, event_type, notes, status, created_at, updated_at)`
          : `(tenant_id, full_name, phone, event_type, notes, status, created_at, updated_at)`;
        const vals = email
          ? `($1::integer, $2, $3, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), 'pending', NOW(), NOW())`
          : `($1::integer, $2, $3, NULLIF($4,''), NULLIF($5,''), 'pending', NOW(), NOW())`;
        const params = email
          ? [tenantId, full_name, email, phone, event_type, notes]
          : [tenantId, full_name, phone, event_type, notes];

        const { rows: inserted } = await client.query(
          `INSERT INTO bookings.customers ${cols} VALUES ${vals}
           RETURNING id, full_name, email, phone`,
          params
        );
        row     = inserted[0];
        created = true;
      }

      await logger.info(
        'CustomersRoute',
        `Customer ${created ? 'created' : 'resolved'}: ${row.id}`,
        { customer_id: row.id, tenant_id: tenantId, source },
        tenantId
      );

      return { success: true, data: { ...row, created } };
    });
  });


  // ─── POST /customers/update ────────────────────────────────────────────────
  // Replaces: UpdateCustomerWF → DB: Update Customer + DB: Log Update Interaction
  //
  // Body fields (all optional except customer_id):
  //   customer_id   UUID  — required
  //   full_name     string
  //   email         string
  //   phone         string
  //   event_type    string
  //   notes         string
  //   interaction_note  string  — written to customer_interactions (defaults to generic)
  //
  // tenant_id is taken from JWT — never from the body.
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id'],
        properties: {
          customer_id:       { type: 'string', format: 'uuid' },
          full_name:         { type: 'string'  },
          email:             { type: 'string'  },
          phone:             { type: 'string'  },
          event_type:        { type: 'string'  },
          notes:             { type: 'string'  },
          interaction_note:  { type: 'string'  },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      full_name        = '',
      email            = '',
      phone            = '',
      event_type       = '',
      notes            = '',
      interaction_note = '',
    } = request.body;

    // Explicit validation beyond JSON schema (CLAUDE.md §2.5)
    assertUUID(customer_id, 'customer_id');
    if (email) assertEmail(email, 'email');

    return withTenantContext(tenantId, async (client) => {
      // Step 1 — COALESCE update: blank strings leave existing value intact
      const { rowCount } = await client.query(
        `UPDATE bookings.customers
         SET
           full_name  = COALESCE(NULLIF($3::text, ''),  full_name),
           email      = COALESCE(NULLIF($4::text, ''),  email),
           phone      = COALESCE(NULLIF($5::text, ''),  phone),
           event_type = COALESCE(NULLIF($6::text, ''),  event_type),
           notes      = COALESCE(NULLIF($7::text, ''),  notes),
           updated_at = NOW()
         WHERE id        = $1::uuid
           AND tenant_id = $2`,
        [customer_id, tenantId, full_name, email, phone, event_type, notes]
      );

      if (rowCount === 0) throw notFound('Customer', customer_id);

      // Step 2 — Fetch updated row to include in response + interaction log
      const { rows: [customer] } = await client.query(
        `SELECT id, full_name, email, phone, event_type, notes, updated_at
         FROM   bookings.customers
         WHERE  id = $1::uuid AND tenant_id = $2`,
        [customer_id, tenantId]
      );

      // Step 3 — Audit interaction (mirrors DB: Log Update Interaction)
      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, customer_name, customer_email, customer_phone,
            booking_id, room_name, subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL,
                 $7, 'customer_updated', $6, $8, NOW())`,
        [
          tenantId,
          customer.id,
          customer.full_name,
          customer.email   ?? '',
          customer.phone   ?? '',
          interaction_note || `Fields updated via API: ${[full_name && 'name', email && 'email', phone && 'phone'].filter(Boolean).join(', ') || 'no changes'}`,
          `Customer record updated: ${customer.full_name}`,
          staffActor(request),
        ]
      );

      await logger.info(
        'CustomersRoute',
        `Customer updated: ${customer_id}`,
        { customer_id, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: customer };
    });
  });


  // ─── POST /customers/update-status ────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Update Status
  //
  // Updates the CRM lifecycle status of a customer record, sets first_contact_date
  // when status transitions to 'contacted', and records who made the change.
  //
  // Body:
  //   customer_id   UUID   — required
  //   status        string — required  (pending | contacted | booked | cancelled)
  //   assigned_to   string — optional  staff member name
  //
  // tenant_id is taken from JWT — never from the body.
  fastify.post('/update-status', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'status'],
        properties: {
          customer_id:  { type: 'string', format: 'uuid' },
          status:       { type: 'string', enum: ['pending', 'contacted', 'booked', 'cancelled'] },
          assigned_to:  { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      status,
      assigned_to = null,
    } = request.body;

    assertUUID(customer_id, 'customer_id');

    return withTenantContext(tenantId, async (client) => {
      const { rowCount, rows } = await client.query(
        `UPDATE bookings.customers
         SET
           status             = $3,
           first_contact_date = CASE WHEN $3 = 'contacted' THEN NOW() ELSE first_contact_date END,
           assigned_to        = COALESCE($4, assigned_to),
           updated_at         = NOW()
         WHERE id        = $1::uuid
           AND tenant_id = $2
         RETURNING id, status, assigned_to, first_contact_date, updated_at`,
        [customer_id, tenantId, status, assigned_to]
      );

      if (rowCount === 0) throw notFound('Customer', customer_id);

      // Build subject in JS (Pattern 3: avoid $N reuse across type contexts)
      const subject = `Customer status updated to: ${status}`;

      await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, subject, interaction_type, notes, staff_member, timestamp)
         VALUES ($1, $2::uuid, $3, 'status_updated', $4, $5, NOW())`,
        [
          tenantId,
          customer_id,
          subject,
          assigned_to ? `Assigned to: ${assigned_to}` : 'No assignment change',
          staffActor(request),
        ]
      ).catch(() => { /* non-fatal */ });

      await logger.info(
        'CustomersRoute',
        `Customer status updated: ${customer_id} → ${status}`,
        { customer_id, status, tenant_id: tenantId },
        tenantId
      );

      return { success: true, data: rows[0] };
    });
  });


  // ─── GET /customers/list ──────────────────────────────────────────────────
  // Replaces: bLsB0v8ZyKpvb8pz → DB: Customers (all-customers webhook path)
  //
  // Returns all customers for the tenant ordered by created_at DESC,
  // with latest booking/request dates resolved via COALESCE subqueries.
  fastify.get('/list', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           c.id,
           c.full_name,
           c.email,
           c.phone,
           c.event_type,
           c.event_date,
           c.guests_count,
           c.status,
           c.created_at,
           c.notes,
           COALESCE(
             (SELECT cb.date_from FROM bookings.confirmed_bookings cb
              WHERE cb.customer_id = c.id AND cb.status != 'cancelled'
              ORDER BY COALESCE(cb.date_from, cb.booking_date) DESC LIMIT 1),
             (SELECT br.date_from FROM bookings.booking_requests br
              WHERE br.customer_id = c.id ORDER BY br.created_at DESC LIMIT 1)
           ) AS date_from,
           COALESCE(
             (SELECT cb.date_to FROM bookings.confirmed_bookings cb
              WHERE cb.customer_id = c.id AND cb.status != 'cancelled'
              ORDER BY COALESCE(cb.date_from, cb.booking_date) DESC LIMIT 1),
             (SELECT br.date_to FROM bookings.booking_requests br
              WHERE br.customer_id = c.id ORDER BY br.created_at DESC LIMIT 1)
           ) AS date_to,
           COALESCE(
             (SELECT cb.guest_count FROM bookings.confirmed_bookings cb
              WHERE cb.customer_id = c.id AND cb.status != 'cancelled'
              ORDER BY COALESCE(cb.date_from, cb.booking_date) DESC LIMIT 1),
             (SELECT br.guest_count FROM bookings.booking_requests br
              WHERE br.customer_id = c.id ORDER BY br.created_at DESC LIMIT 1),
             c.guests_count
           ) AS guest_count
         FROM bookings.customers c
         WHERE c.tenant_id = $1::integer
         ORDER BY c.created_at DESC`,
        [tenantId]
      );

      return { success: true, data: rows };
    });
  });

  // ─── GET /customers/interactions ──────────────────────────────────────────
  // Returns interaction log for a customer (by customer_id or email).
  // Replaces nW4p6cg3l7OHwjQP → PG - Get Interactions.
  //
  // Query params:
  //   customer_id (UUID)  — preferred lookup key
  //   email (string)      — fallback; omit both to get all interactions for tenant
  //   limit (int)         — default 100
  fastify.get('/interactions', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId  = request.user.tenant_id;
    const { customer_id, email, limit = '100' } = request.query;
    const maxRows = Math.min(parseInt(limit, 10) || 100, 500);

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT
           ci.id,
           ci.tenant_id,
           ci.customer_id,
           COALESCE(NULLIF(ci.customer_name,  ''), c.full_name, 'Unknown') AS customer_name,
           COALESCE(NULLIF(ci.customer_email, ''), c.email,     '')        AS customer_email,
           COALESCE(NULLIF(ci.customer_phone, ''), c.phone,     '')        AS customer_phone,
           ci.booking_id,
           ci.booking_date,
           COALESCE(NULLIF(ci.room_name, ''), r.name, '')                  AS room_name,
           ci.subject,
           ci.interaction_type,
           ci.notes,
           ci.staff_member,
           ci.timestamp
         FROM bookings.customer_interactions ci
         LEFT JOIN bookings.customers c ON c.id::text = ci.customer_id::text AND c.tenant_id = ci.tenant_id
         LEFT JOIN bookings.confirmed_bookings cb ON cb.id::text = ci.booking_id::text
         LEFT JOIN bookings.rooms r ON r.id = cb.room_id
         WHERE ci.tenant_id = $1::integer
           AND ($2::text IS NULL OR ci.customer_id::text = $2
             OR ci.customer_email ILIKE $2)
           AND ($3::text IS NULL OR ci.customer_email ILIKE $3)
         ORDER BY ci.timestamp DESC
         LIMIT $4`,
        [
          tenantId,
          customer_id || null,
          email       || null,
          maxRows,
        ]
      )
    );

    return { success: true, data: rows };
  });


  // ─── POST /customers/log-interaction ─────────────────────────────────────
  // Creates a customer_interactions row from the dashboard Log Interaction modal.
  //
  // Body:
  //   customer_id       UUID    required
  //   subject           string  required
  //   interaction_type  string  required
  //   notes             string  optional
  //   staff_member      string  optional
  //   customer_name     string  optional
  //   customer_email    string  optional
  //   customer_phone    string  optional
  //   booking_id        UUID    optional (nullable)
  //   booking_date      string  optional (YYYY-MM-DD or ISO timestamp)
  //   room_name         string  optional
  //
  // Returns: { success: true, data: { id } }
  fastify.post('/log-interaction', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['customer_id', 'subject', 'interaction_type'],
        properties: {
          customer_id:      { type: 'string' },
          subject:          { type: 'string' },
          interaction_type: { type: 'string' },
          notes:            { type: 'string',  default: '' },
          staff_member:     { type: 'string',  default: 'Staff' },
          customer_name:    { type: 'string',  default: '' },
          customer_email:   { type: 'string',  default: '' },
          customer_phone:   { type: 'string',  default: '' },
          booking_id:       { type: 'string' },
          booking_date:     { type: 'string' },
          room_name:        { type: 'string',  default: '' },
        },
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      customer_id,
      subject,
      interaction_type,
      notes          = '',
      staff_member   = 'Staff',
      customer_name  = '',
      customer_email = '',
      customer_phone = '',
      booking_id,
      booking_date,
      room_name      = '',
    } = request.body;

    assertUUID(customer_id, 'customer_id');
    if (booking_id) assertUUID(booking_id, 'booking_id');

    return withTenantContext(tenantId, async (client) => {
      const { rows: [row] } = await client.query(
        `INSERT INTO bookings.customer_interactions
           (tenant_id, customer_id, customer_name, customer_email, customer_phone,
            booking_id, booking_date, room_name, subject, interaction_type, notes,
            staff_member, timestamp)
         VALUES
           ($1::integer, $2::uuid, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, NOW())
         RETURNING id::text`,
        [
          tenantId,
          customer_id,
          customer_name,
          customer_email,
          customer_phone,
          booking_id   || null,
          booking_date ? booking_date.slice(0, 10) : null,
          room_name,
          subject,
          interaction_type,
          notes,
          staff_member,
        ]
      );
      return { success: true, data: row };
    });
  });


  // ─── GET /customers/pending-warnings ──────────────────────────────────────
  // Returns customers who are 4–7 days pending with warning_sent = false.
  // Called by the Pending Lifecycle scheduler (service JWT — no user context).
  //
  // Query params: none required (tenant_id comes from JWT).
  fastify.get('/pending-warnings', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT id::text,
                full_name,
                email,
                tenant_id,
                created_at,
                EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS days_pending
         FROM   bookings.customers
         WHERE  status                       = 'pending'
           AND  COALESCE(warning_sent, false) = false
           AND  created_at <= NOW() - INTERVAL '4 days'
           AND  created_at  > NOW() - INTERVAL '7 days'
           AND  tenant_id   = $1::integer`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });


  // ─── POST /customers/mark-warning-sent ────────────────────────────────────
  // Sets warning_sent = true + warning_sent_at = NOW() for a single customer.
  // Called per-customer after the Day 4 warning email is successfully dispatched.
  //
  // Body: { customer_id: UUID }
  fastify.post('/mark-warning-sent', {
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
    const tenantId    = request.user.tenant_id;
    const { customer_id } = request.body;
    assertUUID(customer_id, 'customer_id');

    return withTenantContext(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE bookings.customers
         SET    warning_sent    = true,
                warning_sent_at = NOW()
         WHERE  id        = $1::uuid
           AND  tenant_id = $2::integer`,
        [customer_id, tenantId]
      );

      if (rowCount === 0) throw notFound('Customer', customer_id);
      return { success: true, customer_id };
    });
  });


  // ─── POST /customers/purge-expired ────────────────────────────────────────
  // Atomically deletes all expired pending customers (≥ 7 days old, no confirmed
  // bookings) and their orphaned booking requests in a single transaction.
  // Called by the Pending Lifecycle scheduler; safe to run multiple times.
  //
  // Body: {} (empty — tenant_id comes from JWT)
  // Returns: { success, deleted_count, customer_ids: [uuid, ...] }
  fastify.post('/purge-expired', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      // Step 1 — identify candidates (7+ days pending, no active confirmed bookings)
      const { rows: candidates } = await client.query(
        `SELECT id::text
         FROM   bookings.customers
         WHERE  status     = 'pending'
           AND  tenant_id  = $1::integer
           AND  created_at <= NOW() - INTERVAL '7 days'
           AND  NOT EXISTS (
                  SELECT 1 FROM bookings.confirmed_bookings cb
                  WHERE  cb.customer_id = customers.id
                    AND  cb.tenant_id   = $1::integer
                    AND  cb.status     != 'cancelled'
                )`,
        [tenantId]
      );

      if (candidates.length === 0) {
        return { success: true, deleted_count: 0, customer_ids: [] };
      }

      const ids = candidates.map(r => r.id);

      // Step 2 — delete orphaned booking requests first (FK order)
      await client.query(
        `DELETE FROM bookings.booking_requests
         WHERE  customer_id  = ANY($1::uuid[])
           AND  tenant_id    = $2::integer
           AND  status NOT IN ('booked', 'completed')`,
        [ids, tenantId]
      );

      // Step 3 — delete the customers
      await client.query(
        `DELETE FROM bookings.customers
         WHERE  id        = ANY($1::uuid[])
           AND  status    = 'pending'
           AND  tenant_id = $2::integer`,
        [ids, tenantId]
      );

      await logger.info(
        'CustomersRoute',
        `Purged ${ids.length} expired pending customers`,
        { count: ids.length, tenant_id: tenantId },
        tenantId
      );

      return { success: true, deleted_count: ids.length, customer_ids: ids };
    });
  });


  // ─── GET /customers/repeat-clients ───────────────────────────────────────
  // Customers who have at least one active recurring_rules entry.
  // Joined with their latest active rule, room, and next outstanding payment.
  // Replaces: DB: Get Repeat Clients (GetRepeatClients.json)
  fastify.get('/repeat-clients', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT
          c.id                  AS customer_id,
          c.full_name,
          c.email,
          c.phone,
          c.created_at          AS customer_since,
          rr.id                 AS rule_id,
          rr.day_of_week,
          rr.start_time,
          rr.end_time,
          rr.frequency,
          rr.end_date,
          rr.active             AS series_active,
          ro.name               AS room_name,
          op.due_date           AS next_due_date,
          op.amount_due         AS next_amount_due,
          op.status             AS payment_status
        FROM bookings.customers c
        LEFT JOIN LATERAL (
          SELECT *
          FROM bookings.recurring_rules
          WHERE customer_id = c.id
            AND tenant_id   = $1
            AND active      = TRUE
          ORDER BY created_at DESC
          LIMIT 1
        ) rr ON TRUE
        LEFT JOIN bookings.rooms ro ON ro.id = rr.room_id
        LEFT JOIN LATERAL (
          SELECT *
          FROM bookings.outstanding_payments
          WHERE recurring_rule_id = rr.id
            AND status = 'pending'
          ORDER BY due_date ASC
          LIMIT 1
        ) op ON TRUE
        WHERE c.tenant_id = $1
          AND EXISTS (
            SELECT 1
            FROM bookings.recurring_rules rr2
            WHERE rr2.customer_id = c.id
              AND rr2.tenant_id   = $1
              AND rr2.active      = TRUE
          )
        ORDER BY c.full_name ASC`,
        [tenantId]
      )
    );
    return { success: true, data: rows };
  });

}

module.exports = customersRoutes;
