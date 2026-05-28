'use strict';

/**
 * /leads routes
 * Replaces: BjHe6jnpWTYOcPS3 (Get Leads), LeadsUpdateWF, EditLeadWF
 */

const { withTenantContext }  = require('../db/pool');
const { promoteLead }        = require('../services/LeadPromotion');
const { notFound }           = require('../utils/errors');
const { assertLeadStatus }   = require('../utils/validators');

async function leadsRoutes(fastify) {

  // GET /leads — list all leads for the authenticated tenant
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          limit:  { type: 'integer', default: 100 },
          offset: { type: 'integer', default: 0   },
        },
      },
    },
  }, async (request) => {
    const { status, limit, offset } = request.query;
    const tenantId = request.user.tenant_id;

    return withTenantContext(tenantId, async (client) => {
      const whereClause = status ? 'AND l.status = $3' : '';
      const params = status
        ? [tenantId, limit, status, offset]
        : [tenantId, limit, offset];

      const sql = `
        SELECT l.*
        FROM   leads l
        WHERE  l.tenant_id = $1
        ${whereClause}
        ORDER  BY l.created_at DESC
        LIMIT  $2
        OFFSET ${status ? '$4' : '$3'}`;

      const { rows } = await client.query(sql, params);
      return { success: true, data: rows, count: rows.length };
    });
  });

  // PATCH /leads/:id/status — update lead status (with hot_prospect promotion)
  fastify.patch('/:id/status', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
      },
    },
  }, async (request) => {
    const { id }     = request.params;
    const { status } = request.body;

    // Validate against the canonical status set before touching the DB.
    assertLeadStatus(status);

    // promoteLead handles both hot_prospect (atomic INSERT+UPDATE)
    // and standard status updates (UPDATE only).
    const result = await promoteLead(id, status);
    return { success: true, data: result };
  });

  // PATCH /leads/:id — edit lead fields
  fastify.patch('/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          venue_name:   { type: 'string' },
          contact_name: { type: 'string' },
          email:        { type: 'string' },
          phone:        { type: 'string' },
          website_url:  { type: 'string' },
          notes:        { type: 'string' },
          status:       { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { id }  = request.params;
    const tenantId = request.user.tenant_id;
    const fields   = request.body;

    return withTenantContext(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE leads
         SET
           venue_name   = COALESCE(NULLIF($2, ''), venue_name),
           contact_name = COALESCE(NULLIF($3, ''), contact_name),
           email        = COALESCE(NULLIF($4, ''), email),
           phone        = COALESCE(NULLIF($5, ''), phone),
           website_url  = COALESCE(NULLIF($6, ''), website_url),
           notes        = COALESCE(NULLIF($7, ''), notes),
           status       = COALESCE(NULLIF($8, ''), status)
         WHERE id = $1::uuid
         RETURNING *`,
        [
          id,
          fields.venue_name   ?? '',
          fields.contact_name ?? '',
          fields.email        ?? '',
          fields.phone        ?? '',
          fields.website_url  ?? '',
          fields.notes        ?? '',
          fields.status       ?? '',
        ]
      );

      if (!rows.length) throw notFound('Lead', id);

      return { success: true, data: rows[0] };
    });
  });
}

module.exports = leadsRoutes;
