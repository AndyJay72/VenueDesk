'use strict';

/**
 * payments-manual.js — Dashboard manual payment recording
 *
 * Registered at /payments in server.js alongside the existing paymentsRoutes.
 * Fastify supports multiple plugins at the same prefix — routes are additive.
 *
 * Routes:
 *   POST /payments/pay — authenticated (JWT body-tunnel, Pattern 4)
 *
 * Replaces the n8n pay-balance webhook for dashboard cash/BACS payments.
 *
 * Fix: "Ghost Success"
 *   The old n8n path fanned out Respond: Success in parallel with the DB write,
 *   so the browser received 200 OK before the balance update completed.
 *   Here the INSERT + UPDATE run in a single withTenantContext transaction —
 *   the HTTP response is only sent after both commits succeed.
 *
 * Fix: status never updating
 *   The old /payments/record endpoint only inserted a payments row.
 *   This endpoint atomically updates confirmed_bookings.balance_due AND
 *   sets status = 'confirmed' when balance reaches zero.
 */

const { withTenantContext } = require('../db/pool');

module.exports = async function paymentsManualRoutes(fastify, _opts) {

  // ── POST /payments/pay ───────────────────────────────────────────────────────
  fastify.post('/pay', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId  = req.user.tenant_id;
    const staffUser = req.user.full_name || req.user.username || String(req.user.user_id);

    const {
      booking_id,
      customer_id,
      amount,
      payment_method,
      payment_type,
    } = req.body || {};

    if (!booking_id) return reply.code(400).send({ success: false, message: 'booking_id required' });

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return reply.code(400).send({ success: false, message: 'amount must be > 0' });
    }

    const method = (payment_method || 'cash').toLowerCase();
    const pType  = (payment_type   || 'balance').toLowerCase();

    const result = await withTenantContext(tenantId, async (client) => {

      // 1. Insert payment record
      const { rows: [payment] } = await client.query(
        `INSERT INTO bookings.payments
           (booking_id, customer_id, amount, payment_method, payment_type, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [booking_id, customer_id || null, amountNum, method, pType, tenantId]
      );

      // 2. Atomically update confirmed_bookings — balance_due AND status in one pass.
      //    CASE ensures status only moves forward (provisional → confirmed, never back).
      const { rows: [booking] } = await client.query(
        `UPDATE bookings.confirmed_bookings
         SET balance_due  = GREATEST(0, COALESCE(balance_due, 0) - $1),
             deposit_paid = COALESCE(deposit_paid, 0) + $1,
             status       = CASE
                              WHEN GREATEST(0, COALESCE(balance_due, 0) - $1) <= 0
                              THEN 'confirmed'
                              ELSE COALESCE(NULLIF(status, 'pending'), 'provisional')
                            END,
             updated_at   = NOW()
         WHERE id = $2 AND tenant_id = $3
         RETURNING id, balance_due, status`,
        [amountNum, booking_id, tenantId]
      );

      // 3. Audit log
      await client.query(
        `INSERT INTO bookings.audit_log
           (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, 'manual_payment', 'booking', $2, $3, $4, 'dashboard')`,
        [
          tenantId,
          String(booking_id),
          JSON.stringify({
            amount:         amountNum,
            payment_method: method,
            payment_type:   pType,
            customer_id:    customer_id || null,
            new_status:     booking?.status,
            balance_due:    booking?.balance_due,
          }),
          staffUser,
        ]
      );

      return {
        reference_number: payment.id,
        payment_type:     (booking?.balance_due ?? 1) <= 0 ? 'balance' : 'partial',
        balance_due:      booking?.balance_due ?? null,
        status:           booking?.status    ?? null,
      };
    });

    // Return both `success: true` (new pattern) and `status: 'success'`
    // (legacy n8n pattern) so the dashboard success check works regardless.
    return reply.send({ success: true, status: 'success', ...result });
  });
};
