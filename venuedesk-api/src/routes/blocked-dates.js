'use strict';

/**
 * /blocked-dates routes — Phase 2 SQL Node Purge.
 * Replaces: 3JqHCjua5lKZGpeB.json (Blocked Dates API) Postgres nodes.
 *
 * All tenant_id comes from JWT (authenticated routes) or ?tenant_id= (public route).
 *
 * GET  /blocked-dates/public    — public list for enquiry-form (no JWT, ?tenant_id=N)
 * GET  /blocked-dates           — list all blocked dates for tenant (JWT required)
 * POST /blocked-dates/create    — insert a blocked date rule (JWT required)
 * POST /blocked-dates/delete    — delete a blocked date rule by id (JWT required)
 *
 * Accepted block_type values (both canonical and legacy aliases accepted):
 *   Canonical: 'recurring_weekly' | 'specific_date' | 'date_range'
 *   Legacy:    'recurring'        | 'oneoff'         | 'range'
 */

const { withTenantContext, systemQuery } = require('../db/pool');
const { notFound, badRequest } = require('../utils/errors');

const BLOCK_TYPES = [
  'recurring_weekly', 'specific_date', 'date_range',
  'recurring',        'oneoff',         'range',
];

function isRecurring(t)  { return t === 'recurring_weekly' || t === 'recurring'; }
function isSpecific(t)   { return t === 'specific_date'    || t === 'oneoff'; }
function isRange(t)      { return t === 'date_range'        || t === 'range'; }

const SELECT_SQL = `
  SELECT *
  FROM   bookings.blocked_dates
  WHERE  tenant_id = $1::integer
  ORDER  BY block_type,
            day_of_week  NULLS LAST,
            block_date   NULLS LAST,
            date_from    NULLS LAST`;

async function blockedDatesRoutes(fastify) {

  // ─── GET /blocked-dates/public ────────────────────────────────────────────
  // Public endpoint — no auth. Used by enquiry-form.html (no user session).
  // tenant_id comes from query param; RLS enforced by explicit WHERE clause.
  fastify.get('/public', {}, async (request) => {
    const tenantId = parseInt(request.query.tenant_id, 10);
    if (!tenantId || tenantId < 1000) {
      return { success: true, data: [] };
    }

    const { rows } = await systemQuery(SELECT_SQL, [tenantId]);
    return { success: true, data: rows };
  });

  // ─── GET /blocked-dates ───────────────────────────────────────────────────
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { rows } = await withTenantContext(tenantId, (client) =>
      client.query(SELECT_SQL, [tenantId])
    );
    return { success: true, data: rows };
  });

  // ─── POST /blocked-dates/create ───────────────────────────────────────────
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['block_type'],
        properties: {
          block_type:  { type: 'string', enum: BLOCK_TYPES },
          day_of_week: { type: 'integer', minimum: 0, maximum: 6, nullable: true },
          block_date:  { type: 'string', nullable: true },
          date_from:   { type: 'string', nullable: true },
          date_to:     { type: 'string', nullable: true },
          label:       { type: 'string', default: '' },
          created_by:  { type: 'string', default: 'System' },
          jwt:         { type: 'string' },
          tenant_id:   { type: 'integer' },
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

    if (isRecurring(block_type) && day_of_week == null) {
      throw badRequest('day_of_week required for recurring block type');
    }
    if (isSpecific(block_type) && !block_date) {
      throw badRequest('block_date required for specific_date/oneoff block type');
    }
    if (isRange(block_type) && (!date_from || !date_to)) {
      throw badRequest('date_from and date_to required for date_range/range block type');
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
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id:        { type: 'integer' },
          jwt:       { type: 'string' },
          tenant_id: { type: 'integer' },
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
