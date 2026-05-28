'use strict';

/**
 * Idempotent startup migrations.
 * Executed once at server boot — before routes register, after pool is ready.
 *
 * Strategy
 * ────────
 * 001  (inline)  — bookings.system_logs, bookings.workflow_audit_log
 * 002  (SQL file) — bookings.leads, bookings.lead_activity, bookings.prospects
 *
 * All DDL uses IF NOT EXISTS so re-running is always safe.
 * SQL files live in src/db/migrations/ and are executed in filename order.
 */

const fs           = require('fs');
const path         = require('path');
const { systemQuery } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {

  // ── 001 inline ─────────────────────────────────────────────────────────────
  // system_logs must exist before ErrorHandler can write anything, so it is
  // created first, in-process, before any file migrations run.

  await systemQuery(`
    CREATE TABLE IF NOT EXISTS bookings.system_logs (
      id           BIGSERIAL    PRIMARY KEY,
      level        TEXT         NOT NULL DEFAULT 'info',
      source       TEXT         NOT NULL,
      message      TEXT         NOT NULL,
      detail       JSONB,
      tenant_id    INT,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON bookings.system_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_system_logs_level      ON bookings.system_logs (level);
    CREATE INDEX IF NOT EXISTS idx_system_logs_source     ON bookings.system_logs (source);
  `);

  await systemQuery(`
    CREATE TABLE IF NOT EXISTS bookings.workflow_audit_log (
      id            BIGSERIAL    PRIMARY KEY,
      workflow_name TEXT         NOT NULL,
      event         TEXT         NOT NULL,
      notes         TEXT,
      tenant_id     INT,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wfaudit_created ON bookings.workflow_audit_log (created_at DESC);
  `);

  // ── SQL file migrations ─────────────────────────────────────────────────────
  // Read every *.sql file in migrations/, sorted by filename, and execute.
  // This keeps future migrations as standalone files — no edits to this runner.

  let sqlFiles = [];
  try {
    sqlFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();                       // lexicographic — 001_... before 002_...
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // migrations/ dir doesn't exist yet — nothing to run
  }

  for (const file of sqlFiles) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql      = fs.readFileSync(filePath, 'utf8');
    await systemQuery(sql);
    console.log(`[migrate] applied ${file}`);
  }

  console.log('[migrate] all migrations complete');
}

module.exports = { runMigrations };
