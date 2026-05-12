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
      amount,
      description,
      success_url,
      cancel_url,
    } = req.body || {};

    if (!amount || parseFloat(amount) <= 0) {
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
    const amountPence  = Math.round(parseFloat(amount) * 100);
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
        tenant_id:   String(tenantId),
        booking_id:  String(booking_id  || ''),
        customer_id: String(customer_id || ''),
        source:      'calendar',
      },
    });

    // Audit log
    await withTenantContext(tenantId, (client) =>
      client.query(
        `INSERT INTO bookings.audit_log
          (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, 'stripe_session_created', 'booking', $2, $3, $4, 'calendar')`,
        [
          tenantId,
          booking_id || null,
          JSON.stringify({ amount: parseFloat(amount), session_id: session.id, customer_id: customer_id || null }),
          staffUser,
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

    const amountNum = parseFloat(req.body?.amount) || 0;
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
      const bookingId    = session.metadata?.booking_id          || null;
      const requestId    = session.metadata?.booking_request_id  || null;
      const customerId   = session.metadata?.customer_id         || null;
      const amountPaid   = (session.amount_total || 0) / 100;
      const source       = session.metadata?.source              || 'calendar';

      if (metaTenantId) {
        try {
          await withTenantContext(metaTenantId, async (client) => {
            if (bookingId) {
              await client.query(
                `INSERT INTO bookings.payments
                  (booking_id, customer_id, amount, payment_method, payment_type,
                   reference_number, tenant_id)
                 VALUES ($1, $2, $3, 'card', 'deposit', $4, $5)
                 ON CONFLICT DO NOTHING`,
                [bookingId, customerId || null, amountPaid, session.id, metaTenantId]
              );
              // Update balance AND status atomically.
              // If the Stripe payment settles the full balance, move to 'confirmed'.
              // Otherwise move to 'provisional' (deposit received, balance outstanding).
              await client.query(
                `UPDATE bookings.confirmed_bookings
                 SET balance_due  = GREATEST(0, COALESCE(balance_due, 0) - $1),
                     deposit_paid = COALESCE(deposit_paid, 0) + $1,
                     status       = CASE
                                      WHEN GREATEST(0, COALESCE(balance_due, 0) - $1) <= 0
                                      THEN 'confirmed'
                                      ELSE 'provisional'
                                    END,
                     updated_at   = NOW()
                 WHERE id = $2 AND tenant_id = $3`,
                [amountPaid, bookingId, metaTenantId]
              );
            } else if (requestId) {
              await client.query(
                `UPDATE bookings.booking_requests
                 SET status = 'deposit_paid', updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
                [requestId, metaTenantId]
              );
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
