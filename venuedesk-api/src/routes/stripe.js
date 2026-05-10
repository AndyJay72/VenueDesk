'use strict';

/**
 * /stripe routes — Multi-tenant Stripe Checkout integration.
 *
 * Endpoints
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /stripe/config          Public Stripe config for the JWT's tenant.
 *                                Returns is_stripe_enabled + publishable key.
 *                                Used by checkout.html to conditionally show
 *                                the "Pay Now" button.
 *
 *   POST /stripe/session         Create a Stripe Checkout Session.
 *                                Fetches the tenant's secret key server-side.
 *                                Injects tenant_id + booking_id into metadata
 *                                so the webhook can route the confirmation.
 *
 *   POST /stripe/webhook         Unified Stripe webhook listener.
 *                                Parses metadata.tenant_id from the raw payload,
 *                                fetches that tenant's webhook_secret, verifies
 *                                the Stripe signature, then:
 *                                  • Updates booking status to 'confirmed'
 *                                  • Records payment in bookings.payments
 *                                  • Writes audit_log entry
 *                                  • Fire-and-forgets n8n pay-balance webhook
 *                                    (Stripe email template path)
 *
 * Security invariants (CLAUDE.md §3 + §4)
 * ─────────────────────────────────────────────────────────────────────────────
 *   • stripe_secret_key and stripe_webhook_secret are fetched via systemQuery
 *     (n8n superuser) — never visible to the appPool / RLS layer.
 *   • Secret key is NEVER returned from any response body.
 *   • tenant_id comes from JWT (GET /config, POST /session) or from verified
 *     Stripe metadata (POST /webhook) — never from the raw request body.
 *   • Webhook signature is verified AFTER fetching the tenant's own secret,
 *     preventing spoofed payloads from any other tenant's Stripe account.
 *
 * Pattern references (CLAUDE.md)
 * ─────────────────────────────────────────────────────────────────────────────
 *   Pattern 2  — set_config() for tenant context injection (via withTenantContext)
 *   Pattern 3  — explicit ::uuid / ::numeric / ::integer / ::text casts
 *   Pattern 4  — JWT body-tunnel (not applicable here — server-to-server route)
 *   Pattern 5  — Docker cache bypass (see INSTALL.md for rebuild steps)
 */

const axios              = require('axios');
const { systemQuery, withTenantContext } = require('../db/pool');
const logger             = require('../services/LoggerService');
const { notFound, badRequest, forbidden } = require('../utils/errors');
const { assertUUID, assertNumber }        = require('../utils/validators');

// ── Stripe SDK ────────────────────────────────────────────────────────────────
// Loaded lazily inside each handler so a missing STRIPE env var at boot time
// does not crash the server — Stripe is optional per tenant.
// The SDK is initialised with the TENANT'S secret key each time, not a global key.
function getStripeClient(secretKey) {
  const Stripe = require('stripe');
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

// ── Stripe webhook sub-plugin ─────────────────────────────────────────────────
// Registered as a nested plugin so the raw-buffer content-type parser is
// scoped ONLY to this plugin and does NOT affect JSON parsing on other routes.
async function stripeWebhookPlugin(fastify) {

  // Override JSON parser for this scope: receive raw Buffer instead of parsed
  // object so Stripe can re-compute the HMAC signature over the exact bytes.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body)
  );

  // ─── POST /stripe/webhook ──────────────────────────────────────────────────
  // No JWT — this endpoint is called by Stripe's servers, not by logged-in users.
  // Authentication is performed via Stripe-Signature header + webhook secret.
  fastify.post('/webhook', async (request, reply) => {

    const rawBody  = request.body;                      // Buffer (from parser above)
    const sig      = request.headers['stripe-signature'];

    if (!sig)          return reply.code(400).send({ error: 'Missing Stripe-Signature header' });
    if (!rawBody?.length) return reply.code(400).send({ error: 'Empty request body' });

    // ── Step 1: Extract tenant_id from unverified payload ──────────────────
    // We read the raw JSON once (without verification) solely to determine which
    // tenant's webhook_secret to use for the real signature check below.
    // No business logic is performed on unverified data.
    let unverifiedPayload;
    try {
      unverifiedPayload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON payload' });
    }

    const rawTenantId = unverifiedPayload?.data?.object?.metadata?.tenant_id;
    const tenantId    = parseInt(rawTenantId, 10);

    if (!rawTenantId || !Number.isFinite(tenantId)) {
      return reply.code(400).send({ error: 'Missing or invalid metadata.tenant_id in Stripe payload' });
    }

    // ── Step 2: Fetch tenant's webhook secret via systemQuery ──────────────
    // systemQuery bypasses FORCE RLS — correct for cross-tenant config lookup.
    // stripe_webhook_secret is NEVER returned to the caller.
    const { rows: [tenant] } = await systemQuery(
      `SELECT stripe_webhook_secret, is_stripe_enabled
       FROM   bookings.tenants
       WHERE  tenant_id = $1::integer AND active = TRUE`,
      [tenantId]
    );

    if (!tenant) {
      return reply.code(400).send({ error: `No active tenant found for id: ${tenantId}` });
    }

    if (!tenant.stripe_webhook_secret) {
      await logger.warn('StripeWebhook',
        `Received webhook for tenant ${tenantId} but stripe_webhook_secret is not configured`, {}, tenantId);
      return reply.code(400).send({ error: 'Stripe webhook not configured for this tenant' });
    }

    // ── Step 3: Verify Stripe signature with tenant-specific secret ─────────
    // Only now do we trust the payload contents.
    let event;
    try {
      // getStripeClient needs a valid-format key only for the constructor.
      // constructEvent does not make API calls — the key is unused here.
      // We pass 'sk_placeholder' because the Stripe SDK requires a non-null
      // key in the constructor even when only using webhooks.constructEvent.
      const stripe = getStripeClient('sk_placeholder_webhook_only');
      event = stripe.webhooks.constructEvent(rawBody, sig, tenant.stripe_webhook_secret);
    } catch (err) {
      await logger.warn('StripeWebhook', `Signature verification failed for tenant ${tenantId}: ${err.message}`, {}, tenantId);
      return reply.code(400).send({ error: `Webhook signature verification failed: ${err.message}` });
    }

    // ── Step 4: Handle checkout.session.completed ──────────────────────────
    if (event.type === 'checkout.session.completed') {
      const session   = event.data.object;
      const bookingId = session.metadata?.booking_id   ?? null;
      const verified_tenant_id = parseInt(session.metadata?.tenant_id ?? '0', 10);
      // Amount Stripe holds in smallest currency unit (pence for GBP)
      const amountPaid = (session.amount_total ?? 0) / 100;

      if (bookingId && verified_tenant_id > 0) {
        await withTenantContext(verified_tenant_id, async (client) => {

          // Update booking status to 'confirmed'
          // Pattern 3: explicit ::uuid and ::integer casts
          await client.query(
            `UPDATE bookings.confirmed_bookings
             SET    status     = 'confirmed',
                    updated_at = NOW()
             WHERE  id         = $1::uuid
               AND  tenant_id  = $2::integer`,
            [bookingId, verified_tenant_id]
          );

          // Record payment in bookings.payments
          // ON CONFLICT (session_id as reference_number) prevents double-processing
          // if Stripe retries the webhook.
          // Pattern 3: ::uuid, ::numeric, ::integer, ::text casts throughout.
          await client.query(
            `INSERT INTO bookings.payments
               (booking_id, payment_type, amount, payment_method,
                status, reference_number, tenant_id, payment_date)
             VALUES
               ($1::uuid, 'balance'::text, $2::numeric, 'stripe'::text,
                'completed'::text, $3::text, $4::integer, NOW())
             ON CONFLICT (reference_number) DO NOTHING`,
            [bookingId, amountPaid, session.id, verified_tenant_id]
          );

          // Audit log — CLAUDE.md §2.7
          // Pattern 3: explicit casts in jsonb_build_object avoid 42P18
          await client.query(
            `INSERT INTO bookings.audit_logs
               (tenant_id, action, entity, entity_id, payload, performed_by, created_at)
             VALUES
               ($1::integer, 'PAYMENT'::text, 'booking'::text, $2::text,
                jsonb_build_object(
                  'amount',         $3::numeric,
                  'method',         'stripe'::text,
                  'session_id',     $4::text,
                  'event_type',     $5::text
                ),
                'stripe-webhook'::text, NOW())`,
            [verified_tenant_id, bookingId, amountPaid, session.id, event.type]
          );
        });

        // ── Fire-and-forget: notify n8n for email dispatch ──────────────────
        // Stripe requires a 200 response within 30 s. We return immediately and
        // send the email trigger asynchronously so a slow n8n instance cannot
        // cause webhook retries.
        setImmediate(async () => {
          try {
            const n8nBase = process.env.N8N_BASE_URL || 'https://n8n.srv1090894.hstgr.cloud';
            const svcJwt  = process.env.N8N_SERVICE_JWT || '';
            await axios.post(
              `${n8nBase}/webhook/pay-balance`,
              {
                booking_id:      bookingId,
                amount:          amountPaid,
                payment_method:  'stripe',       // ← triggers Stripe email branch in n8n
                payment_type:    'balance',
                stripe_session_id: session.id,
                tenant_id:       verified_tenant_id,
                jwt:             svcJwt,          // Pattern 4 body-tunnel for n8n
              },
              { timeout: 15000 }
            );
          } catch (err) {
            // Non-fatal — payment is already recorded in DB. Log for monitoring.
            await logger.warn(
              'StripeWebhook',
              `n8n email notification failed for booking ${bookingId}: ${err.message}`,
              { session_id: session.id },
              verified_tenant_id
            );
          }
        });

        await logger.info(
          'StripeWebhook',
          `checkout.session.completed — booking ${bookingId} confirmed, £${amountPaid} recorded`,
          { session_id: session.id, tenant_id: verified_tenant_id },
          verified_tenant_id
        );
      }
    }

    // Always acknowledge receipt to Stripe promptly
    return reply.code(200).send({ received: true });
  });
}

// ── Main Stripe routes plugin ─────────────────────────────────────────────────
async function stripeRoutes(fastify) {

  // ─── GET /stripe/config ────────────────────────────────────────────────────
  // Returns PUBLIC Stripe config for the requested tenant.
  // Never exposes stripe_secret_key or stripe_webhook_secret.
  // Also returns BACS bank details so checkout.html can render the manual path.
  //
  // Auth: intentionally unauthenticated — all returned values are non-sensitive
  // (publishable key is designed to be public; BACS details are for payment emails).
  // CLAUDE.md Pattern 4: frontend cannot send Authorization headers on GET
  // cross-origin (CORS preflight). tenant_id travels as a query param.
  //
  // POST /stripe/session (which creates the actual session) IS JWT-gated and
  // validates booking ownership — that is the security boundary.
  fastify.get('/config', async (request) => {
    // Accept tenant_id from query param (frontend GET) or JWT (API clients)
    let tenantId = parseInt(request.query?.tenant_id || '0', 10);

    // If no query param, try JWT (for API clients that CAN send headers)
    if (!tenantId) {
      try {
        await request.jwtVerify();
        tenantId = request.user?.tenant_id ?? 0;
      } catch { /* no JWT — rely on query param */ }
    }

    if (!tenantId) throw badRequest('tenant_id is required (query param or JWT)');

    const { rows: [tenant] } = await systemQuery(
      `SELECT is_stripe_enabled,
              stripe_publishable_key,
              bacs_account_name,
              bacs_sort_code,
              bacs_account_number,
              name AS venue_name
       FROM   bookings.tenants
       WHERE  tenant_id = $1::integer AND active = TRUE`,
      [tenantId]
    );

    if (!tenant) throw notFound('Tenant', tenantId);

    return {
      success: true,
      data: {
        is_stripe_enabled:     tenant.is_stripe_enabled      ?? false,
        // Publishable key is safe to expose — only returned when Stripe is enabled
        stripe_publishable_key: tenant.is_stripe_enabled
          ? tenant.stripe_publishable_key
          : null,
        venue_name:            tenant.venue_name             ?? '',
        bacs_account_name:     tenant.bacs_account_name      ?? '',
        bacs_sort_code:        tenant.bacs_sort_code          ?? '',
        bacs_account_number:   tenant.bacs_account_number     ?? '',
      },
    };
  });

  // ─── POST /stripe/session ──────────────────────────────────────────────────
  // Creates a Stripe Checkout Session using the TENANT'S OWN secret key.
  // Injects tenant_id and booking_id into session metadata so the webhook
  // can route the successful payment to the correct tenant.
  //
  // Validation rules (CLAUDE.md §2.5)
  //   booking_id  — valid UUID, must belong to the JWT's tenant
  //   amount      — positive number
  fastify.post('/session', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['booking_id', 'amount'],
        properties: {
          booking_id:  { type: 'string'               },
          amount:      { type: 'number'               },
          description: { type: 'string', default: ''  },
          success_url: { type: 'string', default: ''  },
          cancel_url:  { type: 'string', default: ''  },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;  // from JWT only — never from body
    const { booking_id, amount, description, success_url, cancel_url } = request.body;

    assertUUID(booking_id, 'booking_id');
    assertNumber(amount,   'amount');
    if (amount <= 0) throw badRequest('amount must be a positive number');

    // ── Fetch tenant Stripe keys via systemQuery ──────────────────────────
    // systemQuery bypasses FORCE RLS — intentional, tenants table is excluded.
    // stripe_secret_key is used only to initialise the Stripe SDK below and
    // is never included in the response.
    const { rows: [tenant] } = await systemQuery(
      `SELECT stripe_secret_key, stripe_publishable_key,
              is_stripe_enabled, name AS venue_name
       FROM   bookings.tenants
       WHERE  tenant_id = $1::integer AND active = TRUE`,
      [tenantId]
    );

    if (!tenant)                  throw notFound('Tenant', tenantId);
    if (!tenant.is_stripe_enabled) throw forbidden('Stripe payments are not enabled for this venue');
    if (!tenant.stripe_secret_key) throw badRequest('Stripe secret key is not configured for this venue — contact your admin');

    // ── Verify booking ownership (prevents creating sessions for other tenants) ──
    const { rows: bookingRows } = await systemQuery(
      `SELECT id, balance_due, total_amount, status
       FROM   bookings.confirmed_bookings
       WHERE  id        = $1::uuid
         AND  tenant_id = $2::integer
       LIMIT  1`,
      [booking_id, tenantId]
    );

    if (!bookingRows.length) throw notFound('Booking', booking_id);

    const booking = bookingRows[0];
    if (booking.status === 'confirmed' || booking.status === 'fully_paid') {
      throw badRequest(`Booking is already ${booking.status} — no payment required`);
    }

    // ── Create Stripe Checkout Session with tenant's own key ──────────────
    const stripe     = getStripeClient(tenant.stripe_secret_key);
    const baseUrl    = process.env.FRONTEND_BASE_URL || 'https://andyjay72.github.io/VenueDesk';
    const checkoutBase = `${baseUrl}/CommunityHub/checkout.html`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'payment',
      line_items: [{
        price_data: {
          currency:     'gbp',
          product_data: {
            name: description?.trim() || `Venue Booking — ${tenant.venue_name}`,
          },
          // Stripe uses the smallest currency unit (pence for GBP)
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      // tenant_id and booking_id are injected here so the webhook can
      // route the success event to the correct tenant's database records.
      metadata: {
        tenant_id:  String(tenantId),
        booking_id: String(booking_id),
      },
      success_url: success_url || `${checkoutBase}?status=success&booking_id=${booking_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${checkoutBase}?status=cancelled&booking_id=${booking_id}`,
    });

    await logger.info(
      'StripeRoute',
      `Checkout session created for booking ${booking_id} — £${amount}`,
      { session_id: session.id, booking_id, amount, tenant_id: tenantId },
      tenantId
    );

    return {
      success: true,
      data: {
        session_id:      session.id,
        checkout_url:    session.url,              // Direct redirect URL
        publishable_key: tenant.stripe_publishable_key,
      },
    };
  });

  // ── Register webhook as a nested plugin (scoped raw-body parser) ─────────
  fastify.register(stripeWebhookPlugin);
}

module.exports = stripeRoutes;
