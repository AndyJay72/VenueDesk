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

    const data = await withTenantContext(tenantId, async (client) => {
      const { rows: tenantRows } = await client.query(
        `SELECT is_stripe_enabled,
                stripe_publishable_key
         FROM bookings.tenants
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      const { rows: settingRows } = await client.query(
        `SELECT value FROM bookings.settings
         WHERE key = 'staff_notification_email'
         LIMIT 1`
      );
      return {
        ...(tenantRows[0] || {}),
        staff_notification_email: settingRows[0]?.value || null,
      };
    });

    return reply.send({ success: true, data });
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
      recurring_series_id,   // bulk-payment path — "Create Series (Full Cycle Payment)"
      cycle_id,              // Feature C — per-cycle payment path (recurring_payment_schedule.id)
      payment_timing,        // Feature C — 'in_full' | 'in_advance' | 'in_arrears'
      amount,
      description,
      success_url,
      cancel_url,
    } = req.body || {};

    // Feature C mode selection
    //   in_arrears  → SetupIntent (£0 card capture, no charge)
    //   in_advance  → Checkout with setup_future_usage='off_session'
    //                 (charges cycle 1 + saves card for cycles 2..N)
    //   in_full     → Checkout (one-off charge, no card persistence)
    //   <unset>     → Checkout (legacy bulk path, no card persistence)
    const isSetupMode = payment_timing === 'in_arrears';
    const saveCardForFuture = payment_timing === 'in_advance';

    // Amount required for all Checkout modes EXCEPT setup mode (£0 SetupIntent).
    // coerceNumeric strips £/commas, defaults to 0 — single source of truth.
    const safeAmount = coerceNumeric(amount, { fallback: 0, min: 0, scale: 2 });
    if (!isSetupMode && safeAmount <= 0) {
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
    const amountPence  = Math.round(safeAmount * 100);
    const frontendBase = process.env.FRONTEND_URL || 'https://andyjay72.github.io/VenueDesk';

    // Build Checkout params with Feature C branching baked in. Single .create()
    // call across all four paths — DRY win over multiple call sites with
    // divergent parameters.
    const checkoutParams = {
      payment_method_types: ['card'],
      mode:        isSetupMode ? 'setup' : 'payment',
      success_url: success_url || `${frontendBase}/checkout.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  || `${frontendBase}/calendar.html`,
      metadata: {
        tenant_id:           String(tenantId),
        booking_id:          String(booking_id           || ''),
        customer_id:         String(customer_id          || ''),
        recurring_series_id: String(recurring_series_id  || ''),
        cycle_id:            String(cycle_id             || ''),
        payment_timing:      String(payment_timing       || ''),
        source:              cycle_id             ? 'calendar_cycle'
                           : recurring_series_id  ? 'calendar_recurring'
                           : 'calendar',
      },
    };

    if (isSetupMode) {
      // SetupIntent — no line_items, no amount. Stripe collects card and
      // attaches the PaymentMethod to a Customer object.
      //
      // CRITICAL — for mode=setup, customer_creation='always' is NOT supported
      // (it's mode=payment only). If we don't pre-pass a `customer` parameter,
      // Stripe creates the SetupIntent + PaymentMethod with NO Customer attached
      // (verified 2026-05-27 during Test 3 V3: session.customer was null AND
      // si.customer was null, only si.payment_method had a value).
      //
      // Fix: look up or create a Stripe Customer first, then pass `customer: cus_xxx`
      // into the Checkout. This guarantees session.customer is populated AND the
      // saved PaymentMethod is attached to a durable Customer for off-session
      // cron charges later.
      if (customer_id) {
        try {
          // Look up existing stripe_customer_id (might already exist from a prior
          // SetupIntent or in_advance flow for this customer).
          const { rows: [custRow] } = await withTenantContext(tenantId, (client) =>
            client.query(
              `SELECT stripe_customer_id, full_name, email
               FROM bookings.customers
               WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
              [customer_id, tenantId]
            )
          );

          let stripeCustId = custRow?.stripe_customer_id;

          if (!stripeCustId) {
            // No existing Stripe Customer — create one with the customer's
            // name + email for Stripe Dashboard identification.
            const newCust = await stripe.customers.create({
              name:  custRow?.full_name || undefined,
              email: custRow?.email     || undefined,
              metadata: {
                tenant_id:   String(tenantId),
                customer_id: String(customer_id),
              },
            });
            stripeCustId = newCust.id;

            // Persist immediately so a retry on this same /session call doesn't
            // create a second Stripe Customer for the same DB customer.
            await withTenantContext(tenantId, (client) =>
              client.query(
                `UPDATE bookings.customers
                    SET stripe_customer_id = $1, updated_at = NOW()
                  WHERE id = $2::uuid AND tenant_id = $3`,
                [stripeCustId, customer_id, tenantId]
              )
            );
            console.log(`[stripe/session] Stripe Customer created for setup-mode: ${stripeCustId} (db_customer ${customer_id})`);
          }

          checkoutParams.customer = stripeCustId;
        } catch (e) {
          console.warn(`[stripe/session] Stripe Customer lookup/create failed: ${e.message} — proceeding without pre-attached customer`);
        }
      }

      // Mirror metadata onto the SetupIntent itself so off-session cron
      // charges later have the linkage even though the parent session is
      // months old by then.
      checkoutParams.setup_intent_data = {
        metadata: {
          tenant_id:           String(tenantId),
          customer_id:         String(customer_id || ''),
          recurring_series_id: String(recurring_series_id || ''),
          payment_timing:      'in_arrears',
        },
      };
    } else {
      // Payment mode — needs line items + price.
      checkoutParams.line_items = [{
        price_data: {
          currency:     'gbp',
          unit_amount:  amountPence,
          product_data: { name: description || 'Venue Booking Payment' },
        },
        quantity: 1,
      }];

      // For in_advance: also save the card on file so cycles 2..N can be
      // billed off-session by the cron sweep. setup_future_usage='off_session'
      // is the Stripe-native way to do this in one Checkout flow.
      //
      // customer_creation='always' is required because mode='payment' otherwise
      // attaches the saved PaymentMethod to a guest with no Customer object.
      // Without it, session.customer is null in the webhook → webhook's
      // UPDATE customers SET stripe_customer_id = ... is gated off and skips.
      // This is the Stripe-native fix (verified 2026-05-27 during Test 2 V2 smoke).
      if (saveCardForFuture) {
        checkoutParams.customer_creation = 'always';
        checkoutParams.payment_intent_data = {
          setup_future_usage: 'off_session',
          metadata: {
            tenant_id:           String(tenantId),
            customer_id:         String(customer_id || ''),
            recurring_series_id: String(recurring_series_id || ''),
            cycle_id:            String(cycle_id || ''),
            payment_timing:      'in_advance',
          },
        };
      }
    }

    const session = await stripe.checkout.sessions.create(checkoutParams);

    // Audit log — entity flips by specificity: cycle > series > booking.
    // Lets reporting tools group cycle-level events independently of series
    // events, without needing a join through metadata.
    const auditEntity = cycle_id             ? 'recurring_payment_cycle'
                      : recurring_series_id  ? 'recurring_series'
                      : 'booking';
    const auditId     = cycle_id || recurring_series_id || booking_id || null;
    await withTenantContext(tenantId, (client) =>
      client.query(
        `INSERT INTO bookings.audit_log
          (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, 'stripe_session_created', $2, $3, $4, $5, $6)`,
        [
          tenantId,
          auditEntity,
          auditId,
          JSON.stringify({
            amount:              isSetupMode ? 0 : safeAmount,
            mode:                checkoutParams.mode,
            session_id:          session.id,
            customer_id:         customer_id         || null,
            recurring_series_id: recurring_series_id || null,
            cycle_id:            cycle_id            || null,
            payment_timing:      payment_timing      || null,
          }),
          staffUser,
          checkoutParams.metadata.source,
        ]
      )
    );

    return reply.send({
      success:    true,
      url:        session.url,
      session_id: session.id,
      mode:       checkoutParams.mode,
    });
  });


  // ── POST /stripe/cycle-session ──────────────────────────────────────────────
  // Feature C — server-to-server, internal endpoint for the daily cron sweep
  // (n8n workflow #121, see PER_CYCLE_PAYMENT_DESIGN.md §7 + §10).
  //
  // Charges a cycle's amount_due off-session against the customer's saved
  // PaymentMethod. Pairs with the payment_intent.succeeded / payment_failed
  // webhook handlers added in #119 — this endpoint creates the PaymentIntent;
  // the webhook is responsible for confirming the schedule row paid + sessions
  // confirmed + payments row inserted (single source of truth for state changes,
  // per architectural invariant: card payments rows created EXCLUSIVELY by webhook).
  //
  // Auth: server-to-server only. Uses fastify.authenticate which prefers the
  // Authorization Bearer header (per Pattern 4 scope rule — body-tunnel is for
  // browser CORS only; n8n / cron / curl all use the header path). Tenant
  // isolation enforced via JWT claim.
  //
  // Body:
  //   cycle_id        UUID   required — recurring_payment_schedule.id
  //   force_retry     bool   optional default false — allow retry on 'failed'/'overdue' status
  //                                                  (default refuses unless status='pending')
  //
  // Flow:
  //   1. Load schedule row + parent series + customer (single round-trip JOIN)
  //   2. Verify customer has stripe_customer_id + default_payment_method_id
  //      (in_arrears SetupIntent should have populated both; if not, the
  //      customer never completed the setup → 412 PRECONDITION_FAILED)
  //   3. Verify status retry-eligibility (pending always OK; failed/overdue
  //      need force_retry=true to prevent unauthorised re-attempts)
  //   4. Create off-session PaymentIntent (idempotency_key = `cycle_${id}_${attempt+1}`)
  //   5. Stamp schedule row: status='sent', attempt_count++, last_attempt_at=NOW,
  //      stripe_session_id=pi.id. Webhook later flips to paid/failed.
  //   6. Return pi.id + pi.status for the cron to log
  //
  // Sync vs async outcomes:
  //   • pi.status='succeeded' (sync) — webhook will also fire; idempotency
  //     guard (NOT EXISTS on reference_number) prevents double-write.
  //   • pi.status='requires_action' (3DS) — flips schedule to 'failed',
  //     cron-side caller emails customer a reauth link via #122 workflow.
  //   • Stripe SDK throws (declined, network) — flips schedule to 'failed'
  //     with last_payment_error.message captured. Returns 200 (cron expects
  //     200 to continue sweep; failure surfaces in response body + system_logs).
  //
  // Returns: { success, data: { payment_intent_id, status, requires_action } }
  fastify.post('/cycle-session', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId = req.user.tenant_id;
    const { cycle_id, force_retry = false } = req.body || {};

    if (!cycle_id || typeof cycle_id !== 'string') {
      return reply.code(400).send({ success: false, message: 'cycle_id required' });
    }

    // ── 1. Single-pass load: schedule + series + customer + tenant config ────
    // One round trip instead of three sequential queries. Uses INNER JOINs
    // because all three parents are required for a chargeable cycle.
    const row = await withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           rps.id::text                     AS cycle_id,
           rps.status                       AS cycle_status,
           rps.amount_due::text             AS amount_due,
           rps.attempt_count                AS attempt_count,
           rps.period_start::text           AS period_start,
           rps.period_end::text             AS period_end,
           rps.cycle_number                 AS cycle_number,
           rs.id::text                      AS series_id,
           rs.series_name                   AS series_name,
           rs.payment_timing                AS payment_timing,
           c.id::text                       AS customer_id,
           c.full_name                      AS customer_name,
           c.stripe_customer_id             AS stripe_customer_id,
           c.default_payment_method_id      AS default_payment_method_id,
           t.stripe_secret_key              AS stripe_secret_key,
           t.is_stripe_enabled              AS is_stripe_enabled
         FROM bookings.recurring_payment_schedule rps
         INNER JOIN bookings.recurring_series rs ON rs.id = rps.recurring_series_id
         INNER JOIN bookings.customers        c  ON c.id  = rps.customer_id
         INNER JOIN bookings.tenants          t  ON t.tenant_id = rps.tenant_id
         WHERE rps.id        = $1::uuid
           AND rps.tenant_id = $2
         LIMIT 1`,
        [cycle_id, tenantId]
      );
      return rows[0] || null;
    });

    if (!row) return reply.code(404).send({ success: false, message: 'cycle not found' });

    // ── 2. Preflight gates ───────────────────────────────────────────────────
    if (!row.is_stripe_enabled || !row.stripe_secret_key) {
      return reply.code(412).send({ success: false, code: 'STRIPE_DISABLED',
        message: 'Stripe not enabled for tenant' });
    }
    if (!row.stripe_customer_id || !row.default_payment_method_id) {
      return reply.code(412).send({ success: false, code: 'NO_CARD_ON_FILE',
        message: `Customer ${row.customer_name} has no saved payment method — SetupIntent never completed`,
        data: { customer_id: row.customer_id, series_id: row.series_id } });
    }

    // Status gate — pending is the green-path. failed/overdue need explicit
    // force_retry to prevent accidental double-billing on cron jitter.
    const retryEligible = (row.cycle_status === 'pending')
                       || ((row.cycle_status === 'failed' || row.cycle_status === 'overdue') && force_retry === true);
    if (!retryEligible) {
      return reply.code(409).send({ success: false, code: 'NOT_RETRY_ELIGIBLE',
        message: `cycle status '${row.cycle_status}' not eligible (use force_retry=true for failed/overdue)`,
        data: { cycle_status: row.cycle_status, attempt_count: row.attempt_count } });
    }

    let Stripe;
    try { Stripe = require('stripe'); } catch (e) {
      return reply.code(500).send({ success: false, message: 'Stripe SDK not installed' });
    }
    const stripe     = Stripe(row.stripe_secret_key);
    const amountPence = Math.round(parseFloat(row.amount_due) * 100);
    if (amountPence <= 0) {
      return reply.code(400).send({ success: false, code: 'ZERO_AMOUNT',
        message: 'cycle amount_due is zero — nothing to charge' });
    }

    // ── 3. Create off-session PaymentIntent ──────────────────────────────────
    // idempotency_key includes attempt number so a legitimate retry (force_retry
    // on a 'failed' cycle) gets a fresh PaymentIntent. Without the attempt suffix,
    // Stripe would return the original (failed) PaymentIntent and we'd never
    // re-charge.
    let pi;
    let stripeError = null;
    try {
      pi = await stripe.paymentIntents.create({
        amount:         amountPence,
        currency:       'gbp',
        customer:       row.stripe_customer_id,
        payment_method: row.default_payment_method_id,
        confirm:        true,
        off_session:    true,
        description:    `${row.series_name} — Cycle ${row.cycle_number} (${row.period_start} → ${row.period_end})`,
        metadata: {
          tenant_id:           String(tenantId),
          cycle_id:            String(row.cycle_id),
          recurring_series_id: String(row.series_id),
          customer_id:         String(row.customer_id),
          payment_timing:      String(row.payment_timing || ''),
          cycle_number:        String(row.cycle_number),
          attempt:             String(row.attempt_count + 1),
        },
      }, {
        idempotencyKey: `cycle_${row.cycle_id}_attempt_${row.attempt_count + 1}`,
      });
    } catch (err) {
      // Stripe SDK throws on declined / requires_action when off_session=true.
      // The PaymentIntent still exists on Stripe's side — extract it if present.
      stripeError = err;
      pi = err.raw?.payment_intent || err.payment_intent || null;
      console.warn(`[cycle-session] PaymentIntent threw: code=${err.code} type=${err.type} msg="${err.message}"`);
    }

    // ── 4. Stamp schedule row + synchronous-success fallback ─────────────────
    //
    // Three possible outcomes:
    //   (a) pi.status === 'succeeded' — money has moved. Webhook event MAY
    //       arrive separately to flip status→paid, BUT some Stripe test-mode
    //       webhook configs only subscribe to checkout.session.completed and
    //       not payment_intent.succeeded. Without a synchronous fallback the
    //       schedule row would be stuck at 'sent' forever (verified 2026-05-28).
    //       So we do the full webhook-style update inline here: schedule→paid,
    //       confirm sessions, insert payment row, recompute series balance,
    //       persist Stripe customer + PM. The webhook handler stays as a
    //       backup — its NOT EXISTS guards on reference_number make double
    //       fires harmless.
    //   (b) pi.status === 'requires_action' (3DS) OR 'processing' — schedule
    //       stays 'sent', webhook (when it eventually fires) is responsible.
    //   (c) Stripe threw (off_session decline) — schedule→failed.
    const synchronousSuccess = pi?.status === 'succeeded' && !stripeError;
    const newStatus = stripeError       ? 'failed'
                    : synchronousSuccess ? 'paid'
                    :                      'sent';

    await withTenantContext(tenantId, async (client) => {
      await client.query(
        `UPDATE bookings.recurring_payment_schedule
            SET status            = $2::text,
                attempt_count     = attempt_count + 1,
                last_attempt_at   = NOW(),
                stripe_session_id = COALESCE($3::text, stripe_session_id),
                paid_at           = CASE WHEN $2::text = 'paid' THEN NOW() ELSE paid_at END,
                updated_at        = NOW()
          WHERE id        = $1::uuid
            AND tenant_id = $4`,
        [row.cycle_id, newStatus, pi?.id || null, tenantId]
      );

      // Synchronous-success path mirrors stripe.js webhook Branch 0 + the
      // payment_intent.succeeded handler. NOT EXISTS on reference_number
      // means if a webhook fires later, the INSERT no-ops cleanly.
      if (synchronousSuccess) {
        // Confirm cycle sessions
        await client.query(
          `UPDATE bookings.confirmed_bookings
              SET status       = 'confirmed',
                  deposit_paid = total_amount,
                  balance_due  = 0,
                  updated_at   = NOW()
            WHERE payment_schedule_id = $1::uuid
              AND tenant_id           = $2
              AND status              = 'pending'`,
          [row.cycle_id, tenantId]
        );

        // Insert payment row — payment_type='cycle' per migration 021
        await client.query(
          `INSERT INTO bookings.payments
             (booking_id, recurring_series_id, customer_id, amount,
              payment_method, payment_type, status, reference_number, tenant_id)
           SELECT first_session.id, $1::uuid, $2::uuid,
                  $3::numeric, 'card', 'cycle', 'received', $4::text, $5
           FROM bookings.recurring_payment_schedule rps
           LEFT JOIN LATERAL (
             SELECT id FROM bookings.confirmed_bookings
             WHERE payment_schedule_id = rps.id AND tenant_id = $5
             ORDER BY COALESCE(booking_date, date_from) ASC, created_at ASC
             LIMIT 1
           ) first_session ON TRUE
           WHERE rps.id        = $6::uuid
             AND rps.tenant_id = $5
             AND NOT EXISTS (
               SELECT 1 FROM bookings.payments
               WHERE reference_number = $4::text AND tenant_id = $5
             )`,
          [row.series_id, row.customer_id, row.amount_due, pi.id, tenantId, row.cycle_id]
        );

        // Recompute series balance from remaining unpaid cycles
        await client.query(
          `UPDATE bookings.recurring_series rs
              SET balance_due = COALESCE((
                    SELECT SUM(amount_due) FROM bookings.recurring_payment_schedule
                    WHERE recurring_series_id = rs.id
                      AND tenant_id           = rs.tenant_id
                      AND status NOT IN ('paid','cancelled','overridden')
                  ), 0),
                  updated_at = NOW()
            WHERE rs.id        = $1::uuid
              AND rs.tenant_id = $2`,
          [row.series_id, tenantId]
        );

        console.log(`[cycle-session] Sync success: cycle=${row.cycle_id} pi=${pi.id} amount=£${row.amount_due} — schedule/sessions/payment/balance all updated`);
      }
    });

    // ── 5. Response shape — cron uses this to decide next action ────────────
    if (stripeError) {
      return reply.code(200).send({
        success: false,
        code:    'CHARGE_FAILED',
        message: stripeError.message || 'PaymentIntent failed',
        data: {
          payment_intent_id: pi?.id || null,
          status:            pi?.status || 'failed',
          decline_code:      stripeError.decline_code || null,
          stripe_error_code: stripeError.code         || null,
        },
      });
    }

    const requiresAction = pi?.status === 'requires_action' || pi?.status === 'requires_confirmation';
    console.log(`[cycle-session] cycle=${row.cycle_id} amount=£${row.amount_due} pi=${pi.id} status=${pi.status}`);

    return reply.send({
      success: true,
      data: {
        payment_intent_id: pi.id,
        status:            pi.status,
        requires_action:   requiresAction,
        next_action:       pi.next_action || null,   // 3DS challenge URL etc.
      },
    });
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
      const cycleId      = session.metadata?.cycle_id             || null;   // Feature C
      const paymentTiming = session.metadata?.payment_timing      || null;   // Feature C
      const customerId   = session.metadata?.customer_id          || null;
      const sessionMode  = session.mode                           || 'payment';
      const stripeCustId = session.customer                       || null;   // cus_...
      const amountPaid   = (session.amount_total || 0) / 100;
      const source       = session.metadata?.source               || 'calendar';

      // For Feature C in_advance + in_arrears: extract the saved PaymentMethod
      // AND the Stripe Customer ID from the SetupIntent or PaymentIntent.
      // Required for off-session cycle charges via cron.
      //
      // 2026-05-27 — Test 3 V2 revealed session.customer is unreliable for
      // mode=setup Checkout sessions (sometimes populated late, sometimes
      // null). The authoritative source is the SetupIntent/PaymentIntent
      // itself, which is directly attached to the Customer and PaymentMethod.
      // Retrieve unconditionally for cadenced flows so the downstream UPDATE
      // gates don't skip on a momentarily-null session.customer.
      //
      // Done OUTSIDE the withTenantContext block to keep the DB transaction tight.
      let savedPaymentMethodId = null;
      let resolvedStripeCustomerId = stripeCustId;
      if (sessionMode === 'setup' || paymentTiming === 'in_advance') {
        try {
          const Stripe = require('stripe');
          const tenantCfg = await withTenantContext(metaTenantId, (client) =>
            client.query('SELECT stripe_secret_key FROM bookings.tenants WHERE tenant_id=$1 LIMIT 1', [metaTenantId])
          );
          const sk = tenantCfg.rows[0]?.stripe_secret_key;
          if (sk) {
            const stripeClient = Stripe(sk);
            if (sessionMode === 'setup' && session.setup_intent) {
              const si = await stripeClient.setupIntents.retrieve(session.setup_intent);
              savedPaymentMethodId = si.payment_method || null;
              resolvedStripeCustomerId = resolvedStripeCustomerId || si.customer || null;
            } else if (session.payment_intent) {
              const pi = await stripeClient.paymentIntents.retrieve(session.payment_intent);
              savedPaymentMethodId = pi.payment_method || null;
              resolvedStripeCustomerId = resolvedStripeCustomerId || pi.customer || null;
            }
          }
        } catch (e) {
          console.warn('[webhook] PaymentMethod/Customer extraction failed:', e.message);
        }
      }
      // Use the resolved value downstream — falls back to session.customer if
      // SetupIntent/PaymentIntent retrieval also failed.
      const finalStripeCustId = resolvedStripeCustomerId;

      if (metaTenantId) {
        try {
          await withTenantContext(metaTenantId, async (client) => {
            // ── Branch 0 (NEW Feature C) — PER-CYCLE PAYMENT ───────────────
            // Triggered by metadata.cycle_id set in /stripe/session for an
            // in_advance cycle Checkout. Flips that cycle's schedule row to
            // 'paid', confirms only that cycle's sessions (joined via
            // payment_schedule_id FK from migration 020), inserts payments row
            // pinned to first session in the cycle. Most specific branch — runs
            // before recurring_series (which would otherwise sweep all cycles).
            //
            // Pattern 3: $1 (cycleId) is UUID context only; reference_number
            // ($2) is text only — no shared-param type contexts.
            //
            // IMPORTANT GUARD (added 2026-05-27): for in_arrears flows the n8n
            // workflow sends BOTH cycle_id AND mode=setup. We MUST NOT treat
            // setup-mode events as cycle payments — no money moved, no payment
            // row should land. Verified during Test 3: a £0 SetupIntent for
            // 'Test 3 In Arrears Block' incorrectly produced a £160 payments
            // row before this guard was added. The Branch 0b setup handler
            // below is the correct path for these events.
            if (cycleId && sessionMode !== 'setup') {
              // 1. Mark schedule row paid + record stripe_session_id
              await client.query(
                `UPDATE bookings.recurring_payment_schedule
                    SET status            = 'paid',
                        paid_at           = NOW(),
                        stripe_session_id = $2::text,
                        updated_at        = NOW()
                  WHERE id        = $1::uuid
                    AND tenant_id = $3`,
                [cycleId, session.id, metaTenantId]
              );

              // 2. Confirm sessions in this cycle (via payment_schedule_id FK)
              await client.query(
                `UPDATE bookings.confirmed_bookings
                    SET status       = 'confirmed',
                        deposit_paid = total_amount,
                        balance_due  = 0,
                        updated_at   = NOW()
                  WHERE payment_schedule_id = $1::uuid
                    AND tenant_id           = $2
                    AND status              = 'pending'`,
                [cycleId, metaTenantId]
              );

              // 3. Insert payments row — booking_id = first session in cycle
              // for join stability. payment_type='cycle' (new enum value).
              // NOT EXISTS idempotency guard on reference_number.
              await client.query(
                `INSERT INTO bookings.payments
                   (booking_id, recurring_series_id, customer_id, amount,
                    payment_method, payment_type, status, reference_number, tenant_id)
                 SELECT first_session.id, rps.recurring_series_id, rps.customer_id,
                        rps.amount_due, 'card', 'cycle', 'received', $2::text, $3
                 FROM bookings.recurring_payment_schedule rps
                 LEFT JOIN LATERAL (
                   SELECT id FROM bookings.confirmed_bookings
                   WHERE payment_schedule_id = rps.id AND tenant_id = $3
                   ORDER BY COALESCE(booking_date, date_from) ASC, created_at ASC
                   LIMIT 1
                 ) first_session ON TRUE
                 WHERE rps.id        = $1::uuid
                   AND rps.tenant_id = $3
                   AND NOT EXISTS (
                     SELECT 1 FROM bookings.payments
                     WHERE reference_number = $2::text AND tenant_id = $3
                   )`,
                [cycleId, session.id, metaTenantId]
              );

              // 4. Recompute series balance from remaining unpaid schedule rows
              await client.query(
                `UPDATE bookings.recurring_series rs
                    SET balance_due = COALESCE((
                          SELECT SUM(amount_due) FROM bookings.recurring_payment_schedule
                          WHERE recurring_series_id = rs.id
                            AND tenant_id           = rs.tenant_id
                            AND status NOT IN ('paid','cancelled','overridden')
                        ), 0),
                        updated_at = NOW()
                  WHERE rs.id IN (
                    SELECT recurring_series_id FROM bookings.recurring_payment_schedule
                    WHERE id = $1::uuid AND tenant_id = $2
                  )
                    AND rs.tenant_id = $2`,
                [cycleId, metaTenantId]
              );

              // 5. Persist Stripe customer + saved PaymentMethod (in_advance
              // saves card for cycles 2..N). customerId from metadata feeds
              // the WHERE; finalStripeCustId + savedPaymentMethodId are the values.
              // finalStripeCustId resolves from the PaymentIntent (authoritative)
              // when session.customer isn't yet populated (Stripe timing quirk).
              if (customerId && finalStripeCustId) {
                await client.query(
                  `UPDATE bookings.customers
                      SET stripe_customer_id        = COALESCE(stripe_customer_id, $2),
                          default_payment_method_id = COALESCE($3, default_payment_method_id),
                          updated_at                = NOW()
                    WHERE id        = $1::uuid
                      AND tenant_id = $4`,
                  [customerId, finalStripeCustId, savedPaymentMethodId, metaTenantId]
                );
              }

              console.log(`[webhook] Cycle paid: cycle_id=${cycleId} amount=£${amountPaid} session=${session.id} stripe_cust=${finalStripeCustId} pm=${savedPaymentMethodId} tenant=${metaTenantId}`);
              return;   // done with this event — skip the legacy branches
            }

            // ── Branch 0b (NEW Feature C) — SETUP INTENT (in_arrears) ───────
            // Triggered by sessionMode='setup' from /stripe/session for
            // payment_timing='in_arrears'. £0 captured — purpose is to save the
            // card for off-session cycle charges. Persist Stripe IDs, flip
            // card_on_file_at on the series, and flip ALL pending sessions for
            // this series to 'confirmed' (in_arrears trust model: customer
            // gets the sessions immediately, paid in arrears each cycle).
            // NO payments row (no money moved).
            if (sessionMode === 'setup') {
              // finalStripeCustId resolves from SetupIntent (authoritative)
              // when session.customer isn't yet populated.
              if (customerId && finalStripeCustId) {
                await client.query(
                  `UPDATE bookings.customers
                      SET stripe_customer_id        = COALESCE(stripe_customer_id, $2),
                          default_payment_method_id = COALESCE($3, default_payment_method_id),
                          updated_at                = NOW()
                    WHERE id        = $1::uuid
                      AND tenant_id = $4`,
                  [customerId, finalStripeCustId, savedPaymentMethodId, metaTenantId]
                );
              }
              if (seriesId) {
                await client.query(
                  `UPDATE bookings.recurring_series
                      SET card_on_file_at = COALESCE(card_on_file_at, NOW()),
                          updated_at      = NOW()
                    WHERE id        = $1::uuid
                      AND tenant_id = $2`,
                  [seriesId, metaTenantId]
                );

                // Trust-model session confirmation: in_arrears flips ALL pending
                // sessions to 'confirmed' the moment the card is on file. Cycle
                // billing happens after each cycle ends via cron + off-session
                // PaymentIntents; the customer gets the sessions immediately.
                // Mirrors the bulk in_full pattern but without the deposit_paid
                // mutation (no money has moved yet).
                await client.query(
                  `UPDATE bookings.confirmed_bookings
                      SET status     = 'confirmed',
                          updated_at = NOW()
                    WHERE recurring_series_id = $1::uuid
                      AND tenant_id           = $2
                      AND status              = 'pending'`,
                  [seriesId, metaTenantId]
                );
              }
              console.log(`[webhook] SetupIntent saved: customer=${customerId} stripe_customer=${finalStripeCustId} pm=${savedPaymentMethodId} series=${seriesId} tenant=${metaTenantId}`);
              return;   // done — no charge, no payments row
            }

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
              //
              // ⚠ Pattern 3 — $4 (session.id) is used in TWO contexts (column
              // value in SELECT and comparison in NOT EXISTS). Explicit ::text
              // cast on BOTH usages forces unified type inference and avoids
              // PostgreSQL 42P08 ("inconsistent types deduced for parameter $4").
              await client.query(
                `INSERT INTO bookings.payments
                   (booking_id, recurring_series_id, customer_id, amount,
                    payment_method, payment_type, status, reference_number, tenant_id)
                 SELECT first_session.id, $1::uuid, rs.customer_id, $3::numeric,
                        'card', 'full', 'received', $4::text, $2
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
                     WHERE reference_number = $4::text AND tenant_id = $2
                   )`,
                [seriesId, metaTenantId, amountPaid, session.id]
              );

              // Use console.log — matches the pattern used by the other 4 catch
              // blocks in this handler (lines 494/531/556/574). Calling logger
              // here would throw ReferenceError because LoggerService is not
              // imported in stripe.js; that throw would bubble up to
              // withTenantContext's transaction wrapper and ROLLBACK every
              // preceding UPDATE/UPDATE/INSERT. The bulk webhook silently
              // un-paying itself is exactly the failure mode that produced
              // the Learning & Dev + Eleanor Vance stuck-series incident.
              console.log(`[webhook] Recurring series bulk-paid: ${seriesId} — £${amountPaid} (session ${session.id}, tenant ${metaTenantId})`);
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

    // ── EVENT: payment_intent.succeeded ─────────────────────────────────────
    // Feature C — fired when the cron sweep charges a saved card off-session
    // via stripe.paymentIntents.create({ confirm: true, off_session: true }).
    // The PaymentIntent carries metadata.cycle_id (planted at creation time
    // by /stripe/cycle-session, see task #120). This handler mirrors the
    // checkout cycle_id branch but reads from the PaymentIntent object
    // instead of the Checkout Session.
    //
    // Idempotent via NOT EXISTS on reference_number — replayed webhooks
    // never produce duplicate payments rows.
    if (event?.type === 'payment_intent.succeeded') {
      const pi             = event.data?.object || {};
      const piMetaTenant   = parseInt(pi.metadata?.tenant_id || tenantId || '0', 10) || null;
      const piCycleId      = pi.metadata?.cycle_id || null;
      const piCustomerId   = pi.metadata?.customer_id || null;
      const piAmount       = (pi.amount_received || pi.amount || 0) / 100;

      if (piMetaTenant && piCycleId) {
        try {
          await withTenantContext(piMetaTenant, async (client) => {
            // 1. Mark schedule row paid
            await client.query(
              `UPDATE bookings.recurring_payment_schedule
                  SET status            = 'paid',
                      paid_at           = NOW(),
                      stripe_session_id = $2::text,
                      updated_at        = NOW()
                WHERE id        = $1::uuid
                  AND tenant_id = $3`,
              [piCycleId, pi.id, piMetaTenant]
            );

            // 2. Confirm sessions in this cycle (via payment_schedule_id FK)
            await client.query(
              `UPDATE bookings.confirmed_bookings
                  SET status       = 'confirmed',
                      deposit_paid = total_amount,
                      balance_due  = 0,
                      updated_at   = NOW()
                WHERE payment_schedule_id = $1::uuid
                  AND tenant_id           = $2
                  AND status              = 'pending'`,
              [piCycleId, piMetaTenant]
            );

            // 3. Insert payments row — pi.id as reference_number (idempotent)
            await client.query(
              `INSERT INTO bookings.payments
                 (booking_id, recurring_series_id, customer_id, amount,
                  payment_method, payment_type, status, reference_number, tenant_id)
               SELECT first_session.id, rps.recurring_series_id, rps.customer_id,
                      rps.amount_due, 'card', 'cycle', 'received', $2::text, $3
               FROM bookings.recurring_payment_schedule rps
               LEFT JOIN LATERAL (
                 SELECT id FROM bookings.confirmed_bookings
                 WHERE payment_schedule_id = rps.id AND tenant_id = $3
                 ORDER BY COALESCE(booking_date, date_from) ASC, created_at ASC
                 LIMIT 1
               ) first_session ON TRUE
               WHERE rps.id        = $1::uuid
                 AND rps.tenant_id = $3
                 AND NOT EXISTS (
                   SELECT 1 FROM bookings.payments
                   WHERE reference_number = $2::text AND tenant_id = $3
                 )`,
              [piCycleId, pi.id, piMetaTenant]
            );

            // 4. Recompute series balance
            await client.query(
              `UPDATE bookings.recurring_series rs
                  SET balance_due = COALESCE((
                        SELECT SUM(amount_due) FROM bookings.recurring_payment_schedule
                        WHERE recurring_series_id = rs.id
                          AND tenant_id           = rs.tenant_id
                          AND status NOT IN ('paid','cancelled','overridden')
                      ), 0),
                      updated_at = NOW()
                WHERE rs.id IN (
                  SELECT recurring_series_id FROM bookings.recurring_payment_schedule
                  WHERE id = $1::uuid AND tenant_id = $2
                )
                  AND rs.tenant_id = $2`,
              [piCycleId, piMetaTenant]
            );

            console.log(`[webhook] Off-session cycle paid: cycle_id=${piCycleId} amount=£${piAmount} pi=${pi.id} tenant=${piMetaTenant}`);
          });
        } catch (e) {
          console.error('[webhook] payment_intent.succeeded DB error:', e.message);
        }
      }
    }

    // ── EVENT: payment_intent.payment_failed ────────────────────────────────
    // Feature C — off-session charge declined. Flip schedule row to 'failed',
    // increment attempt_count, surface for staff via system_logs. Cron sweep
    // will retry on next run (subject to attempt_count threshold — handled
    // in cron logic, not here).
    if (event?.type === 'payment_intent.payment_failed') {
      const pi           = event.data?.object || {};
      const piMetaTenant = parseInt(pi.metadata?.tenant_id || tenantId || '0', 10) || null;
      const piCycleId    = pi.metadata?.cycle_id || null;
      const failReason   = pi.last_payment_error?.message || 'unknown';

      if (piMetaTenant && piCycleId) {
        try {
          await withTenantContext(piMetaTenant, async (client) => {
            await client.query(
              `UPDATE bookings.recurring_payment_schedule
                  SET status            = 'failed',
                      stripe_session_id = $2::text,
                      attempt_count     = attempt_count + 1,
                      last_attempt_at   = NOW(),
                      updated_at        = NOW()
                WHERE id        = $1::uuid
                  AND tenant_id = $3`,
              [piCycleId, pi.id, piMetaTenant]
            );
            console.warn(`[webhook] Cycle charge failed: cycle_id=${piCycleId} pi=${pi.id} reason="${failReason}"`);
          });
        } catch (e) {
          console.error('[webhook] payment_intent.payment_failed DB error:', e.message);
        }
      }
    }

    return reply.send({ received: true });
  });
};
