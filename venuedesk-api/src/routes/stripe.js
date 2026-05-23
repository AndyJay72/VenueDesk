'use strict';

/**
 * stripe.js — Stripe payment routes
 *
 * Registered at /stripe in server.js.
 *
 * Routes:
 *   GET  /stripe/config           — public; returns is_stripe_enabled + publishable key + venue_name ONLY
 *                                   (BACS fields removed — use /bacs-details with auth)
 *   GET  /stripe/bacs-details     — authenticated; returns BACS account fields for pay modal display
 *   POST /stripe/session          — authenticated; creates a Checkout Session (staff/calendar)
 *   POST /stripe/public-session   — unauthenticated; creates a Checkout Session for public enquiry form
 *                                   tenant_id validated server-side; amount bounded; enumeration-safe
 *   POST /stripe/webhook          — Stripe webhook (signature-verified)
 *
 * Security notes:
 *   - Pattern 4 (JWT body-tunnel): POST /session reads jwt from req.body.jwt
 *   - /public-session validates tenant exists + is_active before using stored secret key
 *   - /config never returns secret key, webhook secret, or BACS fields
 *   - Tenant enumeration on /public-session returns 404 for both missing and inactive tenants
 *   - All DB access via pool.js helpers (withTenantContext) — never fastify.pg
 */

const { withTenantContext } = require('../db/pool');
const {
  normaliseBookingRequest,
  coerceNumeric,
} = require('../lib/booking-normalize');

const PUBLIC_SESSION_MIN_AMOUNT = 10;   // £10 minimum deposit
const PUBLIC_SESSION_MAX_AMOUNT = 500;  // £500 maximum deposit

module.exports = async function stripeRoutes(fastify, _opts) {

  // ── GET /stripe/config ──────────────────────────────────────────────────────
  fastify.get('/config', async (req, reply) => {
    const tenantId = parseInt(req.query.tenant_id || '0', 10);
    if (!tenantId) {
      return reply.code(400).send({ success: false, message: 'tenant_id required' });
    }

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT is_stripe_enabled,
                stripe_publishable_key
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      )
    );
    return reply.send({ success: true, data: rows[0] || {} });
  });

  // ── GET /stripe/bacs-details ────────────────────────────────────────────────
  fastify.get('/bacs-details', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId = req.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT bacs_account_name,
                bacs_sort_code,
                bacs_account_number
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      )
    );
    return reply.send({ success: true, data: rows[0] || {} });
  });

  // ── POST /stripe/session ────────────────────────────────────────────────────
  fastify.post('/session', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId  = req.user.tenant_id;
    const staffUser = req.user.full_name || req.user.username || String(req.user.user_id);
    const {
      booking_id,
      customer_id,
      recurring_series_id,   // NEW — bulk-payment path for "Create Series (Full Cycle Payment)"
      amount,
      description,
      success_url,
      cancel_url,
    } = req.body || {};

    // Dual-ingestion: amount may arrive as a number ("£12.50" from a sloppy
    // legacy panel, "12.50", 12.5, or 1250 in pence). coerceNumeric strips
    // currency symbols + commas, then we validate. Single source of truth
    // for the rest of the function.
    const safeAmount = coerceNumeric(amount, { fallback: 0, min: 0, scale: 2 });
    if (safeAmount <= 0) {
      return reply.code(400).send({ success: false, message: 'amount must be > 0' });
    }

    const cfg = await withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT stripe_secret_key, is_stripe_enabled
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      return rows[0] || {};
    });

    if (!cfg.is_stripe_enabled) {
      return reply.code(400).send({ success: false, message: 'Stripe payments are not enabled for this venue' });
    }
    if (!cfg.stripe_secret_key) {
      return reply.code(400).send({ success: false, message: 'Stripe secret key not configured — please add it in Admin Config' });
    }

    let Stripe;
    try { Stripe = require('stripe'); } catch (e) {
      return reply.code(500).send({ success: false, message: 'Stripe SDK not installed on server' });
    }

    const stripe       = Stripe(cfg.stripe_secret_key);
    const amountPence  = Math.round(safeAmount * 100);   // coerced above
    const frontendBase = process.env.FRONTEND_URL || 'https://andyjay72.github.io/VenueDesk';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'gbp',
          unit_amount:  amountPence,
          product_data: { name: description || 'Venue Booking Payment' },
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: success_url || `${frontendBase}/checkout.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${frontendBase}/calendar.html`,
      metadata: {
        tenant_id:           String(tenantId),
        booking_id:          String(booking_id           || ''),
        customer_id:         String(customer_id          || ''),
        recurring_series_id: String(recurring_series_id  || ''),
        source:              recurring_series_id ? 'calendar_recurring' : 'calendar',
      },
    });

    // Audit log — entity flips to 'recurring_series' for bulk-payment sessions
    // so the audit ledger groups by the correct entity type for reporting.
    await withTenantContext(tenantId, (client) =>
      client.query(
        `INSERT INTO bookings.audit_log
          (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, 'stripe_session_created', $2, $3, $4, $5, $6)`,
        [
          tenantId,
          recurring_series_id ? 'recurring_series' : 'booking',
          recurring_series_id || booking_id || null,
          JSON.stringify({
            amount:     safeAmount,
            session_id: session.id,
            customer_id:         customer_id         || null,
            recurring_series_id: recurring_series_id || null,
          }),
          staffUser,
          recurring_series_id ? 'calendar_recurring' : 'calendar',
        ]
      )
    );

    return reply.send({ success: true, url: session.url, session_id: session.id });
  });

  // ── POST /stripe/public-session ─────────────────────────────────────────────
  fastify.post('/public-session', async (req, reply) => {
    const rawTenantId = parseInt(req.body?.tenant_id || '0', 10);
    if (!rawTenantId) {
      return reply.code(400).send({ success: false, message: 'tenant_id required' });
    }

    // Dual-ingestion: amount might arrive as '£25.00' or '25.00' or 25 from
    // legacy callers. coerceNumeric strips currency/comma/whitespace.
    const amountNum = coerceNumeric(req.body?.amount, { fallback: 0, min: 0, scale: 2 });
    if (amountNum < PUBLIC_SESSION_MIN_AMOUNT || amountNum > PUBLIC_SESSION_MAX_AMOUNT) {
      return reply.code(400).send({
        success: false,
        message: `Deposit must be between £${PUBLIC_SESSION_MIN_AMOUNT} and £${PUBLIC_SESSION_MAX_AMOUNT}`,
      });
    }

    const { booking_request_id, description, success_url, cancel_url } = req.body || {};

    // Validate tenant — withTenantContext sets app.tenant_id = rawTenantId so
    // FORCE RLS filters to only rows where tenant_id matches. Combined with the
    // explicit WHERE clause, returns a row only for a valid, active tenant.
    // Any DB error is caught and treated as 404 to prevent tenant enumeration.
    let cfg;
    try {
      cfg = await withTenantContext(rawTenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT tenant_id, stripe_secret_key, is_stripe_enabled
           FROM bookings.tenants
           WHERE tenant_id = $1
             AND is_active = TRUE
           LIMIT 1`,
          [rawTenantId]
        );
        return rows[0] || null;
      });
    } catch (err) {
      cfg = null;
    }

    if (!cfg) return reply.code(404).send({});

    if (!cfg.is_stripe_enabled || !cfg.stripe_secret_key) {
      return reply.code(400).send({ success: false, message: 'Online payments are not available for this venue' });
    }

    let Stripe;
    try { Stripe = require('stripe'); } catch (e) {
      return reply.code(500).send({ success: false, message: 'Stripe SDK not installed on server' });
    }

    const stripe       = Stripe(cfg.stripe_secret_key);
    const amountPence  = Math.round(amountNum * 100);
    const frontendBase = process.env.FRONTEND_URL || 'https://andyjay72.github.io/VenueDesk';

    const safeDescription = typeof description === 'string'
      ? description.replace(/[<>"']/g, '').substring(0, 200)
      : 'Venue Deposit';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'gbp',
          unit_amount:  amountPence,
          product_data: { name: safeDescription },
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: success_url || `${frontendBase}/checkout.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${frontendBase}/enquiry-form.html?t=${rawTenantId}`,
      metadata: {
        tenant_id:          String(cfg.tenant_id),
        booking_request_id: String(booking_request_id || ''),
        source:             'enquiry-form',
      },
    });

    // Audit log
    await withTenantContext(cfg.tenant_id, (client) =>
      client.query(
        `INSERT INTO bookings.audit_log
          (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, 'public_stripe_session_created', 'enquiry', $2, $3, NULL, 'enquiry-form')`,
        [
          cfg.tenant_id,
          booking_request_id || null,
          JSON.stringify({ amount: amountNum, session_id: session.id }),
        ]
      )
    );

    return reply.send({ success: true, url: session.url, session_id: session.id });
  });

  // ── POST /stripe/webhook ────────────────────────────────────────────────────
  fastify.post('/webhook', async (req, reply) => {
    const tenantId = parseInt(req.query.tenant_id || '0', 10) || null;

    let webhookSecret = null;
    if (tenantId) {
      try {
        const { rows } = await withTenantContext(tenantId, (client) =>
          client.query(
            `SELECT stripe_webhook_secret
             FROM bookings.tenants WHERE tenant_id = $1 LIMIT 1`,
            [tenantId]
          )
        );
        webhookSecret = rows[0]?.stripe_webhook_secret || null;
      } catch (e) {
        // Ignore — proceed without webhook verification
      }
    }

    let event;
    if (webhookSecret) {
      let Stripe;
      try { Stripe = require('stripe'); } catch (e) {
        return reply.code(500).send({ error: 'Stripe SDK not installed' });
      }
      try {
        // req.rawBody is the raw Buffer set by addContentTypeParser in server.js.
        // Must pass Buffer — stripe.webhooks.constructEvent verifies the exact
        // signed bytes. Re-serialising via JSON.stringify changes whitespace/order
        // and breaks the HMAC. Also trim the secret: env vars from deployment
        // tools (Docker, Heroku, etc.) sometimes have trailing newlines.
        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
        const sig     = req.headers['stripe-signature'];
        const secret  = webhookSecret.trim();
        const stripe  = Stripe('placeholder_only_used_for_webhook_construction');
        event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      } catch (err) {
        return reply.code(400).send({ error: 'Webhook signature verification failed: ' + err.message });
      }
    } else {
      event = req.body;
    }

    if (event?.type === 'checkout.session.completed') {
      const session      = event.data?.object || {};
      const metaTenantId = parseInt(session.metadata?.tenant_id || tenantId || '0', 10) || null;
      const bookingId    = session.metadata?.booking_id           || null;
      const requestId    = session.metadata?.booking_request_id   || null;
      const seriesId     = session.metadata?.recurring_series_id  || null;
      const customerId   = session.metadata?.customer_id          || null;
      const amountPaid   = (session.amount_total || 0) / 100;
      const source       = session.metadata?.source               || 'calendar';

      if (metaTenantId) {
        try {
          await withTenantContext(metaTenantId, async (client) => {
            // ── Branch 1 — RECURRING SERIES (bulk payment) ─────────────────
            // Triggered by metadata.recurring_series_id set in /stripe/session
            // for "Create Series (Full Cycle Payment)". Bulk-confirms every
            // pending session in the series + zeroes the series balance + inserts
            // a single payments row tied to the series (booking_id NULL).
            //
            // Idempotent on two fronts:
            //   1. Payment INSERT uses NOT EXISTS on reference_number, so a
            //      replayed webhook never produces a duplicate row.
            //   2. Booking UPDATE filters status='pending' (which the series-
            //      creation path stamps on every row), so a second run is a
            //      no-op on already-confirmed rows.
            if (seriesId) {
              await client.query(
                `UPDATE bookings.confirmed_bookings cb
                 SET    status       = 'confirmed',
                        deposit_paid = cb.total_amount,
                        balance_due  = 0,
                        updated_at   = NOW()
                 WHERE  cb.recurring_series_id = $1::uuid
                   AND  cb.tenant_id           = $2
                   AND  cb.status              = 'pending'`,
                [seriesId, metaTenantId]
              );

              await client.query(
                `UPDATE bookings.recurring_series
                 SET    balance_due = 0,
                        updated_at  = NOW()
                 WHERE  id        = $1::uuid
                   AND  tenant_id = $2`,
                [seriesId, metaTenantId]
              );

              // Single payment row for the bulk charge.
              // booking_id is pinned to the FIRST session in the series — this
              // is a defensive choice in case payments.booking_id has NOT NULL
              // enforcement. The semantic "owner" of the payment is the series
              // (recurring_series_id), but tying it to session #1 gives a stable
              // anchor for per-booking joins without requiring a schema change.
              // customer_id is derived from the series itself (self-healing,
              // mirrors the bookingId branch's COALESCE($2::uuid, cb.customer_id)).
              await client.query(
                `INSERT INTO bookings.payments
                   (booking_id, recurring_series_id, customer_id, amount,
                    payment_method, payment_type, status, reference_number, tenant_id)
                 SELECT first_session.id, $1::uuid, rs.customer_id, $3::numeric,
                        'card', 'full', 'received', $4, $2
                 FROM bookings.recurring_series rs
                 LEFT JOIN LATERAL (
                   SELECT id FROM bookings.confirmed_bookings
                   WHERE recurring_series_id = rs.id AND tenant_id = $2
                   ORDER BY COALESCE(booking_date, date_from) ASC, created_at ASC
                   LIMIT 1
                 ) first_session ON TRUE
                 WHERE rs.id = $1::uuid AND rs.tenant_id = $2
                   AND NOT EXISTS (
                     SELECT 1 FROM bookings.payments
                     WHERE reference_number = $4 AND tenant_id = $2
                   )`,
                [seriesId, metaTenantId, amountPaid, session.id]
              );

              await logger.info(
                'StripeWebhook',
                `Recurring series bulk-paid: ${seriesId} — £${amountPaid}`,
                { recurring_series_id: seriesId, amount: amountPaid, session_id: session.id, tenant_id: metaTenantId },
                metaTenantId
              );
            } else if (bookingId) {
              // customer_id derived from the booking row itself (self-healing)
              // — metadata.customer_id used only as override when present. This
              // closes a regression where calendar QB Stripe sessions omitted
              // customer_id from metadata, producing orphaned payment rows.
              await client.query(
                `INSERT INTO bookings.payments
                  (booking_id, customer_id, amount, payment_method, payment_type,
                   reference_number, tenant_id)
                 SELECT $1, COALESCE($2::uuid, cb.customer_id), $3, 'card', 'deposit',
                        $4, $5
                 FROM bookings.confirmed_bookings cb
                 WHERE cb.id = $1 AND cb.tenant_id = $5
                 ON CONFLICT DO NOTHING`,
                [bookingId, customerId || null, amountPaid, session.id, metaTenantId]
              );
              // Update balance AND status atomically.
              // If the Stripe payment settles the full balance, move to 'confirmed'.
              // Otherwise move to 'provisional' (deposit received, balance outstanding).
              // ── Idempotent balance recompute (Self-healing) ──────────
              // Pure function of bookings.payments: running this 10 times
              // produces the same result as running it once. Replaces the
              // earlier additive `balance_due = balance_due - $1` which
              // double-counted on Stripe webhook retries OR any other
              // upstream double-write (e.g. n8n HTTP retry-on-glitch).
              //
              // Filters status <> 'cancelled' so refunded/voided payment
              // rows are excluded from the recompute.
              //
              // Status logic preserves the existing two-state behaviour
              // (confirmed when paid in full, provisional otherwise) but
              // adds a guard that respects an already-cancelled booking —
              // we don't want a stray webhook reviving a cancelled row.
              await client.query(
                `UPDATE bookings.confirmed_bookings cb
                 SET deposit_paid = COALESCE(
                       (SELECT SUM(amount) FROM bookings.payments
                        WHERE booking_id = cb.id
                          AND payment_type = 'deposit'
                          AND status <> 'cancelled'),
                       0),
                     balance_due  = GREATEST(0, cb.total_amount - COALESCE(
                       (SELECT SUM(amount) FROM bookings.payments
                        WHERE booking_id = cb.id
                          AND status <> 'cancelled'),
                       0)),
                     status       = CASE
                                      WHEN cb.status = 'cancelled' THEN cb.status
                                      WHEN cb.total_amount - COALESCE(
                                        (SELECT SUM(amount) FROM bookings.payments
                                         WHERE booking_id = cb.id
                                           AND status <> 'cancelled'),
                                        0) <= 0 THEN 'confirmed'
                                      ELSE 'provisional'
                                    END,
                     updated_at   = NOW()
                 WHERE cb.id = $1 AND cb.tenant_id = $2`,
                [bookingId, metaTenantId]
              );
            } else if (requestId) {
              // ── Promote + backfill computed fields (idempotent) ──────
              // COALESCE guarantees: only nulls get filled. Staff-set or
              // already-computed values pass through untouched. Wrapped in
              // try/catch at the outer scope so the Stripe webhook still
              // returns 200 even if normalisation throws.
              let calcFields = { total_hours: null, estimated_cost: null, deposit_amount: amountPaid };
              try {
                // Pull the row's existing times + room rate to feed the helper
                const existing = await client.query(
                  `SELECT br.start_time, br.end_time, br.total_hours,
                          br.estimated_cost, br.deposit_amount, br.deposit_intent,
                          br.total_cost, r.day_rate
                   FROM bookings.booking_requests br
                   LEFT JOIN bookings.rooms r ON r.id = br.room_id
                   WHERE br.id = $1 AND br.tenant_id = $2 LIMIT 1`,
                  [requestId, metaTenantId]
                );
                if (existing.rows.length > 0) {
                  const row = existing.rows[0];
                  calcFields = normaliseBookingRequest(
                    {
                      start_time:     row.start_time,
                      end_time:       row.end_time,
                      total_hours:    row.total_hours,
                      estimated_cost: row.estimated_cost,
                      total_cost:     row.total_cost,
                      deposit_amount: row.deposit_amount,
                      deposit_intent: true,   // we only reach this branch on a paid deposit
                    },
                    { ratePerHour: parseFloat(row.day_rate) || null,
                      stripeSession: session,
                      defaultDeposit: 10.00 }
                  );
                }
              } catch (e) {
                console.warn('[webhook] backfill normalisation threw:', e.message);
              }

              await client.query(
                `UPDATE bookings.booking_requests
                 SET status         = 'deposit_paid',
                     total_hours    = COALESCE(total_hours,    $3),
                     estimated_cost = COALESCE(estimated_cost, $4),
                     deposit_amount = COALESCE(deposit_amount, $5),
                     updated_at     = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
                [requestId, metaTenantId,
                 calcFields.total_hours,
                 calcFields.estimated_cost,
                 calcFields.deposit_amount]
              );

              // ── Backfill the confirmed_booking row the trigger just created ──
              // The trg_auto_promote_deposit_paid trigger copies booking_request →
              // confirmed_bookings, but it omits payment_method, deposit_paid_date,
              // guest_count, and notes. Backfill them here from the source row so
              // dashboards (bookings.html / customers.html / accounts.html) have
              // the full picture without manual reconciliation.
              // Idempotent: COALESCE-only, never overwrites staff-set values.
              try {
                await client.query(
                  `UPDATE bookings.confirmed_bookings cb
                   SET payment_method     = COALESCE(cb.payment_method, 'card'),
                       deposit_paid_date  = COALESCE(cb.deposit_paid_date, NOW()),
                       guest_count        = COALESCE(cb.guest_count, br.guest_count)
                   FROM bookings.booking_requests br
                   WHERE cb.id = $1
                     AND br.id = $1
                     AND cb.tenant_id = $2`,
                  [requestId, metaTenantId]
                );
              } catch (e) {
                console.warn('[webhook] confirmed_booking backfill failed:', e.message);
              }

              // ── Write the payments row (the one staff/admin would normally
              //     create via the "Take Payment" modal). Without this, the
              //     deposit is logged on confirmed_bookings.deposit_paid but
              //     never appears in the ledger or on accounts.html.
              //     Idempotent via WHERE NOT EXISTS — safe against Stripe
              //     webhook retries.
              try {
                await client.query(
                  `INSERT INTO bookings.payments
                     (booking_id, customer_id, amount, payment_method, payment_type,
                      reference_number, tenant_id, payment_date)
                   SELECT $1, br.customer_id, $3, 'card', 'deposit',
                          $4, $2, NOW()
                   FROM bookings.booking_requests br
                   WHERE br.id = $1 AND br.tenant_id = $2
                     AND NOT EXISTS (
                       SELECT 1 FROM bookings.payments
                       WHERE booking_id = $1 AND payment_type = 'deposit'
                     )`,
                  [requestId, metaTenantId, amountPaid, session.id]
                );
              } catch (e) {
                console.warn('[webhook] payments INSERT failed:', e.message);
              }
            }

            await client.query(
              `INSERT INTO bookings.audit_log
                (tenant_id, action, entity, entity_id, payload, staff_user, source)
               VALUES ($1, 'stripe_webhook_received', $2, $3, $4, NULL, $5)`,
              [
                metaTenantId,
                bookingId ? 'booking' : 'enquiry',
                bookingId || requestId || null,
                JSON.stringify({ amount: amountPaid, session_id: session.id, event_type: event.type }),
                source,
              ]
            );
          });
        } catch (e) {
          console.error('[webhook] DB error:', e.message);
        }
      }
    }

    return reply.send({ received: true });
  });
};
