-- 006_rps_phase3_constraints.sql
-- Fixes two live-schema constraints that block the Phase 3 recurring payment handshake.
--
-- Background:
--   Migration 004 used CREATE TABLE IF NOT EXISTS — a no-op on this deployment
--   because the table was created before 004 ran. The pre-existing table has:
--     (a) recurring_rule_id NOT NULL — but phase3 rows (inserted via record-payment)
--         link by recurring_series_id only; they have no rule_id.
--     (b) status CHECK only includes 'pending','paid','overridden','cancelled' — but
--         process-overdue needs to write 'overdue', and queries filter on it.
--
-- Changes (both idempotent):
--   1. Drop NOT NULL on recurring_rule_id so phase3 INSERT rows are accepted.
--      The existing FK (rule_id → recurring_rules.id ON DELETE CASCADE) is preserved
--      but becomes optional — NULL values bypass the FK, non-NULL values still enforce it.
--   2. Replace the status CHECK to include 'overdue', 'sent', and 'failed'.
--      'sent' and 'failed' are written by /stripe/cycle-session (Feature C off-session
--      cron billing). Without them the ADD CONSTRAINT fails against existing rows
--      and rolls back the entire migration batch on every restart.
--
-- Re-running this file is always safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Make recurring_rule_id optional (phase3 rows use recurring_series_id instead)
ALTER TABLE bookings.recurring_payment_schedule
  ALTER COLUMN recurring_rule_id DROP NOT NULL;

-- 2. Replace status CHECK to add 'overdue', 'sent', 'failed'
DO $$
BEGIN
  -- Drop current constraint (name is deterministic on this deployment)
  BEGIN
    ALTER TABLE bookings.recurring_payment_schedule
      DROP CONSTRAINT recurring_payment_schedule_status_check;
  EXCEPTION WHEN undefined_object THEN
    NULL; -- already absent
  END;

  -- Re-add with the full allowed set including Feature C statuses
  BEGIN
    ALTER TABLE bookings.recurring_payment_schedule
      ADD CONSTRAINT recurring_payment_schedule_status_check
      CHECK (status = ANY (ARRAY[
        'pending', 'sent', 'paid', 'failed', 'overridden', 'cancelled', 'overdue'
      ]));
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- already present
  END;
END $$;
