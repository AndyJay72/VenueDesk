'use strict';

/**
 * stripe.js — Stripe payment routes
 *
 * Registered at /stripe in server.js.
 *
 * Routes:
 *   GET  /stripe/config          — public; returns tenant's Stripe + BACS config
 *   POST /stripe/session         — authenticated; creates a Checkout Session
 *   POST /stripe/webhook         — Stripe webhook (signature-verified)
 *
 * Pattern 4 (JWT body-tunnel): browsers cannot send Authorization headers cross-origin,
 * so the JWT travels in req.body.jwt.  The fastify.authenticate decorator handles this.
 */

module.exports = async function stripeRoutes(fastify, _opts) {

  // ── GET /stripe/config ──────────────────────────────────────────────────────
  // Public endpoint — used by enquiry-form.html and calendar.html to decide
  // whether to show the Stripe payment option before any user is logged in.
  // Returns: is_stripe_enabled, stripe_publishable_key, venue_name, BACS fields.
  // Does NOT return secret key or webhook secret.
  fastify.get('/config', async (req, reply) => {
    const tenantId = parseInt(req.query.tenant_id || '0', 10);
    if (!tenantId) {
      return reply.code(400).send({ success: false, message: 'tenant_id required' });
    }

    const client = await fastify.pg.connect();
    try {
      const { rows } = await client.query(
        `SELECT is_stripe_enabled,
                stripe_publishable_key,
                venue_name,
                bacs_account_name,
                bacs_sort_code,
                bacs_account_number
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      return reply.send({ success: true, data: rows[0] || {} });
    } finally {
      client.release();
    }
  });

  // ── POST /stripe/session ────────────────────────────────────────────────────
  // Authenticated. Creates a Stripe Checkout Session for a booking payment.
  // Body: { jwt, booking_id, customer_id, amount, description?, success_url?, cancel_url? }
  // Returns: { success: true, url, session_id }
  fastify.post('/session', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId = req.user.tenant_id;
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

    const client = await fastify.pg.connect();
    try {
      // Fetch the tenant's Stripe secret key
      const { rows } = await client.query(
        `SELECT stripe_secret_key, is_stripe_enabled
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );

      const cfg = rows[0] || {};
      if (!cfg.is_stripe_enabled) {
        return reply.code(400).send({ success: false, message: 'Stripe payments are not enabled for this venue' });
      }
      if (!cfg.stripe_secret_key) {
        return reply.code(400).send({ success: false, message: 'Stripe secret key not configured — please add it in Admin Config' });
      }

      // Lazy-require Stripe so a missing package gives a clear error
      let Stripe;
      try { Stripe = require('stripe'); } catch (e) {
        return reply.code(500).send({ success: false, message: 'Stripe SDK not installed on server' });
      }

      const stripe = Stripe(cfg.stripe_secret_key);
      const amountPence = Math.round(parseFloat(amount) * 100);

      const frontendBase = process.env.FRONTEND_URL || 'https://andyjay72.github.io/VenueDesk';

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'gbp',
            unit_amount: amountPence,
            product_data: {
              name: description || 'Venue Booking Payment',
            },
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: success_url || `${frontendBase}/checkout.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  cancel_url  || `${frontendBase}/calendar.html`,
        metadata: {
          tenant_id:   String(tenantId),
          booking_id:  String(booking_id  || ''),
          customer_id: String(customer_id || ''),
        },
      });

      return reply.send({ success: true, url: session.url, session_id: session.id });
    } finally {
      client.release();
    }
  });

  // ── POST /stripe/webhook ────────────────────────────────────────────────────
  // Called by Stripe. Verifies signature using the tenant's webhook secret.
  // tenant_id must be passed as a query param: /stripe/webhook?tenant_id=1001
  fastify.post('/webhook', async (req, reply) => {
    const tenantId = parseInt(req.query.tenant_id || '0', 10) || null;

    // ── Signature verification ────────────────────────────────────────────────
    let webhookSecret = null;
    if (tenantId) {
      const client = await fastify.pg.connect();
      try {
        const { rows } = await client.query(
          `SELECT stripe_webhook_secret, stripe_secret_key
           FROM bookings.tenants WHERE tenant_id = $1 LIMIT 1`,
          [tenantId]
        );
        webhookSecret = rows[0]?.stripe_webhook_secret || null;
      } finally {
        client.release();
      }
    }

    let event;
    if (webhookSecret) {
      let Stripe;
      try { Stripe = require('stripe'); } catch (e) {
        return reply.code(500).send({ error: 'Stripe SDK not installed' });
      }
      try {
        // Stripe requires the raw body bytes for signature verification.
        // Fastify parses JSON by default; use rawBody if available, otherwise
        // re-stringify (loses whitespace but keeps data — acceptable for testing).
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const sig     = req.headers['stripe-signature'];
        const stripe  = Stripe('placeholder_only_used_for_webhook_construction');
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        return reply.code(400).send({ error: 'Webhook signature verification failed: ' + err.message });
      }
    } else {
      // No secret configured — accept without verification (test / initial setup)
      event = req.body;
    }

    // ── Handle checkout.session.completed ────────────────────────────────────
    if (event?.type === 'checkout.session.completed') {
      const session      = event.data?.object || {};
      const metaTenantId = parseInt(session.metadata?.tenant_id || tenantId || '0', 10) || null;
      const bookingId    = session.metadata?.booking_id  || null;
      const customerId   = session.metadata?.customer_id || null;
      const amountPaid   = (session.amount_total || 0) / 100;

      if (metaTenantId && bookingId) {
        const client = await fastify.pg.connect();
        try {
          // Record deposit payment
          await client.query(
            `INSERT INTO bookings.payments
               (booking_id, customer_id, amount, payment_method, payment_type,
                reference_number, tenant_id)
             VALUES ($1, $2, $3, 'card', 'deposit', $4, $5)
             ON CONFLICT DO NOTHING`,
            [bookingId, customerId || null, amountPaid, session.id, metaTenantId]
          );
          // Reduce balance_due on the confirmed booking
          await client.query(
            `UPDATE bookings.confirmed_bookings
             SET balance_due    = GREATEST(0, COALESCE(balance_due, 0) - $1),
                 deposit_paid   = COALESCE(deposit_paid, 0) + $1,
                 updated_at     = NOW()
             WHERE id = $2 AND tenant_id = $3`,
            [amountPaid, bookingId, metaTenantId]
          );
        } finally {
          client.release();
        }
      }
    }

    return reply.send({ received: true });
  });
};
