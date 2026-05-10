-- 004_recurring_payment_lifecycle.sql
-- Phase 3 — Tiered Payment Lifecycle: schema additions to recurring_payment_schedule.
--
-- Strategy:
--   1. CREATE TABLE IF NOT EXISTS  — safe for fresh deployments (no table yet)
--   2. ALTER TABLE ADD COLUMN IF NOT EXISTS — safe for existing deployments (table exists)
--   3. CREATE UNIQUE INDEX IF NOT EXISTS on (recurring_series_id, cycle_number) — partial,
--      only fires for phase3 rows where both columns are set.  Does NOT conflict with
--      the existing (recurring_rule_id, period_start) constraint on legacy CRB rows.
--   4. Performance indexes — all use IF NOT EXISTS.
--
-- Re-running this file is always safe (fully idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Full table definition for fresh deployments ───────────────────────────
CREATE TABLE IF NOT EXISTS bookings.recurring_payment_schedule (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            INTEGER      NOT NULL,
  recurring_rule_id    UUID,
  customer_id          UUID         NOT NULL,
  period_start         DATE         NOT NULL,
  period_end           DATE,
  amount_due           NUMERIC      NOT NULL DEFAULT 0,
  due_date             DATE,
  status               TEXT         NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','paid','cancelled','overdue')),
  total_cycles         INTEGER,
  remaining_cycles     INTEGER,
  billing_day          INTEGER,
  upfront_paid         BOOLEAN      NOT NULL DEFAULT FALSE,
  payment_timing       TEXT         NOT NULL DEFAULT 'in_advance',
  -- Phase 3 lifecycle columns (added below via ALTER TABLE for existing deployments)
  migration_source     TEXT         NOT NULL DEFAULT 'phase3',
  recurring_series_id  UUID,
  cycle_number         INTEGER,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 2. Add new columns to existing deployments (ALTER is a no-op when IF NOT EXISTS) ──
ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS migration_source     TEXT    NOT NULL DEFAULT 'phase3';

ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS recurring_series_id  UUID;

ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS cycle_number         INTEGER;

ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS reminder_sent_at     TIMESTAMPTZ;

ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

-- ── 3. Unique index: prevents double-seeding from seed-lifecycle-schedule ────
-- Partial predicate mirrors the INSERT ON CONFLICT clause exactly.
-- Rows from the legacy insert-payment-schedule path leave both columns NULL
-- and are therefore invisible to this index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rps_series_cycle
  ON bookings.recurring_payment_schedule (recurring_series_id, cycle_number)
  WHERE recurring_series_id IS NOT NULL AND cycle_number IS NOT NULL;

-- ── 4. Performance indexes ────────────────────────────────────────────────────
-- Reminder query: WHERE status='pending' AND due_date <= threshold
CREATE INDEX IF NOT EXISTS idx_rps_due_date_status
  ON bookings.recurring_payment_schedule (due_date, status);

-- Tenant-scoped status scan
CREATE INDEX IF NOT EXISTS idx_rps_tenant_status
  ON bookings.recurring_payment_schedule (tenant_id, status);

-- Reminder workflow filter: migration_source = 'phase3'
CREATE INDEX IF NOT EXISTS idx_rps_migration_source
  ON bookings.recurring_payment_schedule (migration_source);

-- Series lookup (non-null rows only)
CREATE INDEX IF NOT EXISTS idx_rps_series_id
  ON bookings.recurring_payment_schedule (recurring_series_id)
  WHERE recurring_series_id IS NOT NULL;
