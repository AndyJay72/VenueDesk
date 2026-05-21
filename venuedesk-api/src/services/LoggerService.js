'use strict';

const { systemQuery } = require('../db/pool');

/**
 * LoggerService — structured log writer.
 *
 * Replaces the habit of reading n8n Executions to diagnose failures.
 * Every write goes to bookings.system_logs (created by migrate.js).
 * Console output mirrors the DB write so Docker logs remain readable.
 *
 * Usage:
 *   const log = require('./LoggerService');
 *   await log.info('SchedulerService', 'Lead discovery run started');
 *   await log.error('BillingService', 'Payment insert failed', { scheduleId, err: e.message });
 */

const LEVELS = { info: 'info', warn: 'warn', error: 'error' };

async function write(level, source, message, detail = null, tenantId = null) {
  // Always print to console regardless of DB availability.
  const prefix = `[${level.toUpperCase()}][${source}]`;
  if (level === 'error') {
    console.error(prefix, message, detail ?? '');
  } else {
    console.log(prefix, message, detail ?? '');
  }

  try {
    await systemQuery(
      `INSERT INTO bookings.system_logs (level, source, message, detail, tenant_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [level, source, message, detail ? JSON.stringify(detail) : null, tenantId]
    );
  } catch (dbErr) {
    // If the DB is unavailable we still console-log above — never throw here.
    console.error('[LoggerService] failed to persist log entry:', dbErr.message);
  }
}

const logger = {
  info:  (source, message, detail, tenantId) => write(LEVELS.info,  source, message, detail, tenantId),
  warn:  (source, message, detail, tenantId) => write(LEVELS.warn,  source, message, detail, tenantId),
  error: (source, message, detail, tenantId) => write(LEVELS.error, source, message, detail, tenantId),
};

module.exports = logger;
