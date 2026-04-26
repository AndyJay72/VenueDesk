'use strict';

/**
 * /config routes — Phase 2 SQL Node Purge.
 * Replaces: baGN4RUcgtsDTISA.json (VenuePro - Config Manager) Postgres nodes.
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

const { withTenantContext } = require('../db/pool');
const logger                = require('../services/LoggerService');
const { notFound, conflict, forbidden, badRequest } = require('../utils/errors');
const { assertUUID }        = require('../utils/validators');

async function configRoutes(fastify) {

  // ══════════════════════════════════════════════════════════════════════════
  // ROOMS
  // ══════════════════════════════════════════════════════════════════════════

  // ─── GET /config/rooms ────────────────────────────────────────────────────
  // Mirrors baGN4RUcgtsDTISA → DB: List Rooms.
  fastify.get('/rooms', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { name, capacity = 0, day_rate = 0, half_rate = 0, description = '' } = request.body;

    return withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { id, name, capacity, day_rate, half_rate, description, is_active } = request.body;

    assertUUID(id, 'id');

    return withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { room_id } = request.body;
    assertUUID(room_id, 'room_id');

    return withTenantContext(tenantId, async (client) => {
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
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { name, description = '' } = request.body;

    return withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { id, name, description, is_active } = request.body;
    assertUUID(id, 'id');

    return withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { event_type_id } = request.body;
    assertUUID(event_type_id, 'event_type_id');

    return withTenantContext(tenantId, async (client) => {
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
    const tenantId = request.user.tenant_id;

    const { rows } = await withTenantContext(tenantId, (client) =>
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { room_id, event_type_id, day_rate } = request.body;

    assertUUID(room_id,       'room_id');
    assertUUID(event_type_id, 'event_type_id');

    return withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { room_id, event_type_id } = request.body;

    assertUUID(room_id,       'room_id');
    assertUUID(event_type_id, 'event_type_id');

    return withTenantContext(tenantId, async (client) => {
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
    const tenantId = request.user.tenant_id;

    // Handle both a tenant-scoped settings table and a global one gracefully.
    const { rows } = await withTenantContext(tenantId, async (client) => {
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
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const tenantId = request.user.tenant_id;
    const { key, value } = request.body;

    return withTenantContext(tenantId, async (client) => {
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
}

module.exports = configRoutes;
