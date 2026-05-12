'use strict';

/**
 * audit.js — Audit log write endpoint
 *
 * Registered at /audit in server.js.
 *
 * Routes:
 *   POST /audit/log  — authenticated; records a manual payment or other
 *                      staff action to bookings.audit_log.
 *
 * Security:
 *   - tenant_id comes exclusively from JWT (Pattern 3 — never trusted from body)
 *   - staff_user resolved from JWT claims
 *   - Payload fields accepted from body but tenant cannot be overridden
 */

const { withTenantContext } = require('../db/pool');

module.exports = async function auditRoutes(fastify, _opts) {

  // ── POST /audit/log ─────────────────────────────────────────────────────────
  // Records a staff-initiated action (e.g. manual payment) to audit_log.
  // Body: { action, entity, entity_id, payload?, source }
  // tenant_id and staff_user are resolved from JWT — never from request body.
  fastify.post('/log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const tenantId  = req.user.tenant_id;
    const staffUser = req.user.full_name || req.user.username || String(req.user.user_id);

    const {
      action,
      entity,
      entity_id,
      payload,
      source,
    } = req.body || {};

    if (!action) {
      return reply.code(400).send({ success: false, message: 'action is required' });
    }

    await withTenantContext(tenantId, (client) =>
      client.query(
        `INSERT INTO bookings.audit_log
          (tenant_id, action, entity, entity_id, payload, staff_user, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          action,
          entity    || null,
          entity_id != null ? String(entity_id) : null,
          payload   ? JSON.stringify(payload) : null,
          staffUser,
          source    || null,
        ]
      )
    );

    return reply.send({ success: true });
  });
};
