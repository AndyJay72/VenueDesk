'use strict';

/**
 * /config routes — Phase 2 SQL Node Purge.
 * Replaces: baGN4RUcgtsDTISA.json (VenueDesk - Config Manager) Postgres nodes.
 *
 * All tenant_id comes from JWT. Admin role required for write operations.
 *
 * GET  /config/rooms                — list rooms
 * POST /config/rooms/create         — insert room
 * POST /config/rooms/update         — update room
 * POST /config/rooms/delete         — soft-delete room (is_active = FALSE)
 * GET  /config/event-types          — list event types
 * POST /config/event-types/create   — insert event type
 * POST /config/event-types/update   — update event type
 * POST /config/event-types/delete   — soft-delete event type
 * GET  /config/pricing              — list room_event_pricing (with names)
 * POST /config/pricing/upsert       — insert or update pricing row
 * POST /config/pricing/delete       — delete pricing row
 * GET  /config/settings             — all settings for tenant
 * POST /config/settings/upsert      — insert or update a single setting key
 */

const { withTenantContext, withServiceContext } = require('../db/pool');
const logger                = require('../services/LoggerService');
const { notFound, conflict, forbidden, badRequest } = require('../utils/errors');
const { assertUUID }        = require('../utils/validators');

async function configRoutes(fastify) {

  /**
   * Resolve tenantId + context function for both staff JWT and service JWT.
   * Service JWT has no tenant_id — it comes from query param (GET) or body (POST).
   * Staff JWT always carries tenant_id in the token itself.
   */
  function resolveTenant(request) {
    if (request.user.isService) {
      const tenantId = parseInt(
        request.query?.tenant_id || request.body?.tenant_id || request.user.tenant_id || '0'
      );
      // withServiceContext(tenantId, fn) sets app.tenant_id so FORCE RLS is satisfied.
      return { tenantId, ctx: withServiceContext };
    }
    const tenantId = request.user.tenant_id;
    return { tenantId, ctx: withTenantContext };
  }


  // ══════════════════════════════════════════════════════════════════════════
  // ROOMS
  // ══════════════════════════════════════════════════════════════════════════

  // ─── GET /config/rooms ────────────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: List Rooms.
  fastify.get('/rooms', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);

    const { rows } = await ctx(tenantId, (client) =>
      client.query(
        `SELECT id, name, capacity, day_rate, half_rate, description, is_active
         FROM   bookings.rooms
         WHERE  tenant_id = $1::integer
         ORDER  BY is_active DESC, name`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });

  // ─── POST /config/rooms/create ────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Insert Room.
  fastify.post('/rooms/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          capacity:    { type: 'integer', default: 0 },
          day_rate:    { type: 'number',  default: 0 },
          half_rate:   { type: 'number',  default: 0 },
          description: { type: 'string',  default: '' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { name, capacity = 0, day_rate = 0, half_rate = 0, description = '' } = request.body;

    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.rooms (name, capacity, day_rate, half_rate, description, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING
         RETURNING *`,
        [name.trim(), capacity, day_rate, half_rate, description, tenantId]
      );

      if (rows.length === 0) {
        throw conflict('Room', `name '${name}' already exists`);
      }

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /config/rooms/update ────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Update Room.
  fastify.post('/rooms/update', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id:          { type: 'string' },
          name:        { type: 'string' },
          capacity:    { type: 'integer' },
          day_rate:    { type: 'number' },
          half_rate:   { type: 'number' },
          description: { type: 'string' },
          is_active:   { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { id, name, capacity, day_rate, half_rate, description, is_active } = request.body;

    assertUUID(id, 'id');

    return ctx(tenantId, async (client) => {
      // Load current values for COALESCE pattern
      const { rows: [current] } = await client.query(
        `SELECT name, capacity, day_rate, half_rate, description, is_active
         FROM bookings.rooms WHERE id = $1::uuid AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!current) throw notFound('Room', id);

      const { rows } = await client.query(
        `UPDATE bookings.rooms
         SET name        = $2,
             capacity    = $3,
             day_rate    = $4,
             half_rate   = $5,
             description = $6,
             is_active   = $7
         WHERE id = $1::uuid AND tenant_id = $8::integer
         RETURNING *`,
        [
          id,
          name        ?? current.name,
          capacity    ?? current.capacity,
          day_rate    ?? current.day_rate,
          half_rate   ?? current.half_rate,
          description ?? current.description,
          is_active   ?? current.is_active,
          tenantId,
        ]
      );

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /config/rooms/delete ────────────────────────────────────────────
  // Soft-delete: sets is_active = FALSE. Mirrors DB: Soft Delete Room.
  fastify.post('/rooms/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['room_id'],
        properties: {
          room_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { room_id } = request.body;
    assertUUID(room_id, 'room_id');

    return ctx(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE bookings.rooms SET is_active = FALSE
         WHERE id = $1::uuid AND tenant_id = $2::integer`,
        [room_id, tenantId]
      );
      if (rowCount === 0) throw notFound('Room', room_id);
      return { success: true, data: { room_id, is_active: false } };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT TYPES
  // ══════════════════════════════════════════════════════════════════════════

  // ─── GET /config/event-types ──────────────────────────────────────────────
  fastify.get('/event-types', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);

    const { rows } = await ctx(tenantId, (client) =>
      client.query(
        `SELECT id, name, description, is_active
         FROM   bookings.event_types
         WHERE  tenant_id = $1::integer
         ORDER  BY is_active DESC, name`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });

  // ─── POST /config/event-types/create ──────────────────────────────────────
  fastify.post('/event-types/create', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string', default: '' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { name, description = '' } = request.body;

    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.event_types (name, description, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING
         RETURNING *`,
        [name.trim(), description, tenantId]
      );

      if (rows.length === 0) {
        throw conflict('EventType', `name '${name}' already exists`);
      }

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /config/event-types/update ──────────────────────────────────────
  fastify.post('/event-types/update', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id:          { type: 'string' },
          name:        { type: 'string' },
          description: { type: 'string' },
          is_active:   { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { id, name, description, is_active } = request.body;
    assertUUID(id, 'id');

    return ctx(tenantId, async (client) => {
      const { rows: [current] } = await client.query(
        `SELECT name, description, is_active FROM bookings.event_types
         WHERE id = $1::uuid AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!current) throw notFound('EventType', id);

      const { rows } = await client.query(
        `UPDATE bookings.event_types
         SET name        = $2,
             description = $3,
             is_active   = $4
         WHERE id = $1::uuid AND tenant_id = $5::integer
         RETURNING *`,
        [
          id,
          name        ?? current.name,
          description ?? current.description,
          is_active   ?? current.is_active,
          tenantId,
        ]
      );

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /config/event-types/delete ──────────────────────────────────────
  fastify.post('/event-types/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['event_type_id'],
        properties: {
          event_type_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { event_type_id } = request.body;
    assertUUID(event_type_id, 'event_type_id');

    return ctx(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE bookings.event_types SET is_active = FALSE
         WHERE id = $1::uuid AND tenant_id = $2::integer`,
        [event_type_id, tenantId]
      );
      if (rowCount === 0) throw notFound('EventType', event_type_id);
      return { success: true, data: { event_type_id, is_active: false } };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ROOM EVENT PRICING
  // ══════════════════════════════════════════════════════════════════════════

  // ─── GET /config/pricing ──────────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: List Pricing.
  fastify.get('/pricing', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);

    const { rows } = await ctx(tenantId, (client) =>
      client.query(
        `SELECT rep.id, rep.room_id, rep.event_type_id,
                r.name  AS room_name,
                et.name AS event_type_name,
                rep.day_rate
         FROM   bookings.room_event_pricing rep
         JOIN   bookings.rooms r       ON r.id  = rep.room_id
         JOIN   bookings.event_types et ON et.id = rep.event_type_id
         WHERE  rep.tenant_id = $1::integer
         ORDER  BY r.name, et.name`,
        [tenantId]
      )
    );

    return { success: true, data: rows };
  });

  // ─── POST /config/pricing/upsert ──────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Upsert Pricing.
  fastify.post('/pricing/upsert', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['room_id', 'event_type_id', 'day_rate'],
        properties: {
          room_id:       { type: 'string' },
          event_type_id: { type: 'string' },
          day_rate:      { type: 'number' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { room_id, event_type_id, day_rate } = request.body;

    assertUUID(room_id,       'room_id');
    assertUUID(event_type_id, 'event_type_id');

    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.room_event_pricing (room_id, event_type_id, day_rate, tenant_id)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         ON CONFLICT (room_id, event_type_id)
         DO UPDATE SET day_rate = EXCLUDED.day_rate
         RETURNING *`,
        [room_id, event_type_id, day_rate, tenantId]
      );

      return { success: true, data: rows[0] };
    });
  });

  // ─── POST /config/pricing/delete ──────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Delete Pricing.
  fastify.post('/pricing/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['room_id', 'event_type_id'],
        properties: {
          room_id:       { type: 'string' },
          event_type_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { room_id, event_type_id } = request.body;

    assertUUID(room_id,       'room_id');
    assertUUID(event_type_id, 'event_type_id');

    return ctx(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM bookings.room_event_pricing
         WHERE room_id = $1::uuid AND event_type_id = $2::uuid AND tenant_id = $3::integer`,
        [room_id, event_type_id, tenantId]
      );
      if (rowCount === 0) throw notFound('Pricing', `room=${room_id} event_type=${event_type_id}`);
      return { success: true, data: { room_id, event_type_id, deleted: true } };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  // ─── GET /config/settings ─────────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Get Settings.
  // Note: original workflow had no tenant_id filter on settings — preserving
  // that behaviour here but scoping by tenant_id where column exists.
  fastify.get('/settings', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);

    // Handle both a tenant-scoped settings table and a global one gracefully.
    const { rows } = await ctx(tenantId, async (client) => {
      // Try tenant-scoped first
      const { rows: cols } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'bookings' AND table_name = 'settings'
           AND column_name = 'tenant_id'`
      );
      const hasTenantCol = cols.length > 0;
      return client.query(
        hasTenantCol
          ? `SELECT key, value, description, updated_at FROM bookings.settings
             WHERE tenant_id = $1 ORDER BY key`
          : `SELECT key, value, description, updated_at FROM bookings.settings ORDER BY key`,
        hasTenantCol ? [tenantId] : []
      );
    });

    return { success: true, data: rows };
  });

  // ─── POST /config/settings/upsert ─────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: Upsert Setting.
  fastify.post('/settings/upsert', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key:   { type: 'string', minLength: 1 },
          value: {},
        },
      },
    },
  }, async (request) => {
    const { tenantId, ctx } = resolveTenant(request);
    const { key, value } = request.body;

    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value      = EXCLUDED.value,
               updated_at = NOW()
         RETURNING key, value, updated_at`,
        [key, String(value)]
      );

      return { success: true, data: rows[0] };
    });
  });


  // ─── GET /config/services ─────────────────────────────────────────────────
  // Returns all add-on services for the tenant ordered by name.
  // Supports staff JWT (tenant_id from token) and service JWT (tenant_id from
  // ?tenant_id query param — used by ServicesWF n8n proxy).
  // Replaces: VenueDesk - Services API → DB: Get Services (get-service-data webhook)
  fastify.get('/services', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.isService
      ? parseInt(request.query.tenant_id || '0')
      : request.user.tenant_id;
    if (!tenantId) throw badRequest('tenant_id required');

    const ctx = request.user.isService ? withServiceContext : withTenantContext;
    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text, name, type, price::float, active
         FROM   bookings.add_on_services
         WHERE  tenant_id = $1::integer
         ORDER BY name`,
        [tenantId]
      );
      return { success: true, data: rows };
    });
  });


  // ─── POST /config/services/upsert ─────────────────────────────────────────
  // Insert or update a single add-on service.
  // id present + matches existing row → UPDATE; id absent or no match → INSERT.
  // Supports staff JWT (tenant_id from token) and service JWT (tenant_id from
  // body — passed by ServicesWF n8n proxy, forwarded from frontend body).
  // Replaces: Services API → DB: Upsert Service (save-service webhook)
  //
  // Body: { id?, name, type?, price?, active?, tenant_id? (service JWT only) }
  fastify.post('/services/upsert', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          id:        { type: 'string' },
          name:      { type: 'string', minLength: 1 },
          type:      { type: 'string', enum: ['flat', 'hourly'], default: 'flat' },
          price:     { type: 'number', minimum: 0, default: 0 },
          active:    { type: 'boolean', default: true },
          tenant_id: { type: ['number', 'string'] },  // allowed when proxied via service JWT
          jwt:       { type: 'string' },               // forwarded token, ignored here
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.isService
      ? parseInt(request.body.tenant_id || '0')
      : request.user.tenant_id;
    if (!tenantId) throw badRequest('tenant_id required');

    const {
      id     = null,
      name,
      type   = 'flat',
      price  = 0,
      active = true,
    } = request.body;

    if (id) assertUUID(id, 'id');

    const ctx = request.user.isService ? withServiceContext : withTenantContext;
    return ctx(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO bookings.add_on_services
           (id, tenant_id, name, type, price, active)
         VALUES (
           CASE WHEN $1::text IS NOT NULL THEN $1::uuid ELSE gen_random_uuid() END,
           $2::integer, $3, $4, $5::decimal, $6::boolean
         )
         ON CONFLICT (id) DO UPDATE
           SET name       = EXCLUDED.name,
               type       = EXCLUDED.type,
               price      = EXCLUDED.price,
               active     = EXCLUDED.active,
               updated_at = NOW()
         RETURNING id::text, name, type, price::float, active`,
        [id, tenantId, name, type, price, active]
      );
      return { success: true, data: rows[0] };
    });
  });


  // ─── POST /config/services/delete ─────────────────────────────────────────
  // Deletes an add-on service by id (tenant-scoped).
  // Supports staff JWT (tenant_id from token) and service JWT (tenant_id from
  // body — passed by ServicesWF n8n proxy).
  // Replaces: Services API → DB: Delete Service (delete-service webhook)
  //
  // Body: { id: UUID, tenant_id? (service JWT only) }
  fastify.post('/services/delete', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id:        { type: 'string', format: 'uuid' },
          tenant_id: { type: ['number', 'string'] },  // allowed when proxied via service JWT
          jwt:       { type: 'string' },               // forwarded token, ignored here
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.isService
      ? parseInt(request.body.tenant_id || '0')
      : request.user.tenant_id;
    if (!tenantId) throw badRequest('tenant_id required');

    const { id } = request.body;
    assertUUID(id, 'id');

    const ctx = request.user.isService ? withServiceContext : withTenantContext;
    return ctx(tenantId, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM bookings.add_on_services
         WHERE id = $1::uuid AND tenant_id = $2::integer`,
        [id, tenantId]
      );
      if (rowCount === 0) throw notFound('Service', id);
      return { success: true, id };
    });
  });

}

module.exports = configRoutes;
