'use strict';

/**
 * /blocked-dates routes — Phase 2 SQL Node Purge.
 * Replaces: 3JqHCjua5lKZGpeB.json (Blocked Dates API) Postgres nodes.
 *
 * All tenant_id comes from JWT.
 *
 * GET  /blocked-dates         — list all blocked dates for tenant
 * POST /blocked-dates/create  — insert a blocked date rule
 * POST /blocked-dates/delete  — delete a blocked date rule by id
 */

const { withTenantContext } = require('../db/pool');
const { notFound, badRequest } = require('../utils/errors');

async function blockedDatesRoutes(fastify) {

  // ─── GET /blocked-dates ───────────────────────────────────────────────────
  // Mirrors 3JqHCjua5lKZGpeB → GET All.
  // Returns blocked dates ordered by type, then day/date fields.
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(
        `SELECT *
         FROM   bookings.blocked_dates
         WHERE  tenant_id = $1::integer
         ORDER  BY block_type,
                   day_of_week  NULLS LAST,
                   block_date   NULLS LAST,
                   date_from    NULLS LAST`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });

  // ─── POST /blocked-dates/create ───────────────────────────────────────────
  // Mirrors 3JqHCjua5lKZGpeB → INSERT.
  // block_type: 'recurring_weekly' | 'specific_date' | 'date_range'
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['block_type'],
        properties: {
          block_type:  { type: 'string', enum: ['recurring_weekly', 'specific_date', 'date_range'] },
          day_of_week: { type: 'integer', minimum: 0, maximum: 6, nullable: true },
          block_date:  { type: 'string', nullable: true },
          date_from:   { type: 'string', nullable: true },
          date_to:     { type: 'string', nullable: true },
          label:       { type: 'string', default: '' },
          created_by:  { type: 'string', default: 'System' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const {
      block_type,
      day_of_week = null,
      block_date  = null,
      date_from   = null,
      date_to     = null,
      label       = '',
      created_by  = 'System',
    } = request.body;

    // Basic semantic validation
    if (block_type === 'recurring_weekly' && day_of_week == null) {
      throw badRequest('day_of_week required for block_type=recurring_weekly');
    }
    if (block_type === 'specific_date' && !block_date) {
      throw badRequest('block_date required for block_type=specific_date');
    }
    if (block_type === 'date_range' && (!date_from || !date_to)) {
      throw badRequest('date_from and date_to required for block_type=date_range');
    }

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.blocked_dates
           (block_type, day_of_week, block_date, date_from, date_to, label, created_by, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [block_type, day_of_week, block_date || null, date_from || null, date_to || null,
         label, created_by, tenantId]
      );

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /blocked-dates/delete ───────────────────────────────────────────
  // Mirrors 3JqHCjua5lKZGpeB → DELETE.
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { id } = request.body;

    return withTenantContext(tenantId, async (client) => {
      const { rows, rowCount } = await client.query(
        `DELETE FROM bookings.blocked_dates
         WHERE id = $1 AND tenant_id = $2::integer
         RETURNING id`,
        [id, tenantId]
      );

      if (rowCount === 0) throw notFound('BlockedDate', String(id));

      return { success: true, data: { id: rows[0].id, deleted: true } };
    });
  });
}

module.exports = blockedDatesRoutes;
