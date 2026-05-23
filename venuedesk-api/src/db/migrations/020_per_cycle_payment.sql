-- Migration 020 — Per-Cycle Payment Cadence (Feature C) — REWRITE v2
-- Reference: PER_CYCLE_PAYMENT_DESIGN.md (v2, APPROVED 2026-05-23)
--
-- v1 of this migration assumed a net-new recurring_payment_schedule table.
-- DIAGNOSTIC RESULT: a Phase 3 schedule table already exists with rich columns
-- (period_start/period_end, amount_due, status enum {pending,paid,overridden,
-- cancelled,overdue}, recurring_rule_id FK, billing_day, upfront_paid, etc.).
-- v1's CHECK constraint on status rejected existing 'pending' rows, aborting
-- the whole transaction silently on every boot.
--
-- v2 strategy: EXTEND the existing schema instead of replacing it.
--   • recurring_series: ADD cycle_length_weeks, card_on_file_at (new); ADD
--     CHECK on existing payment_timing (already VARCHAR(20) default 'in_advance').
--   • recurring_payment_schedule: ADD stripe_session_id, attempt_count,
--     last_attempt_at; EXTEND status CHECK to include 'sent' + 'failed'.
--   • confirmed_bookings: ADD payment_schedule_id (FK + partial index).
--   • customers: ADD stripe_customer_id, default_payment_method_id (partial index).
--
-- Naming reconciliation (design doc § will be updated to match):
--   period_start (existing)  ←→ cycle_start_date (design doc v2)
--   period_end   (existing)  ←→ cycle_end_date   (design doc v2)
--   amount_due   (existing)  ←→ amount           (design doc v2)
--
-- Idempotent throughout — DO $$ guards on every constraint, IF NOT EXISTS on
-- every column/index. Safe to re-run on every container restart.

-- ─── 0. Parent-table existence preflight ─────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('bookings.recurring_series')             IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.recurring_series missing'; END IF;
  IF to_regclass('bookings.recurring_payment_schedule')   IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.recurring_payment_schedule missing (Phase 3 dependency)'; END IF;
  IF to_regclass('bookings.confirmed_bookings')           IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.confirmed_bookings missing'; END IF;
  IF to_regclass('bookings.customers')                    IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.customers missing'; END IF;
END $$;


-- ─── 1. recurring_series — cycle_length_weeks + card_on_file_at + payment_timing CHECK ──
-- payment_timing already exists as VARCHAR(20) default 'in_advance' (Phase 3).
-- We add only what's missing and harden the existing column with a CHECK.

ALTER TABLE bookings.recurring_series
  ADD COLUMN IF NOT EXISTS cycle_length_weeks INT,
  ADD COLUMN IF NOT EXISTS card_on_file_at    TIMESTAMPTZ;

-- CHECK on cycle_length_weeks bounds — nullable allowed (in_full series don't need it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recurring_series_cycle_length_chk'
       AND conrelid = 'bookings.recurring_series'::regclass
  ) THEN
    ALTER TABLE bookings.recurring_series
      ADD CONSTRAINT recurring_series_cycle_length_chk
      CHECK (cycle_length_weeks IS NULL OR cycle_length_weeks BETWEEN 1 AND 52);
    RAISE NOTICE '  recurring_series_cycle_length_chk added';
  END IF;
END $$;

-- CHECK on existing payment_timing column — NULL-tolerant so it doesn't reject
-- legacy rows that pre-date Phase 3 (where the column was added nullable).
-- The CHECK enforces the Feature C enum going forward for any non-NULL value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recurring_series_payment_timing_chk'
       AND conrelid = 'bookings.recurring_series'::regclass
  ) THEN
    ALTER TABLE bookings.recurring_series
      ADD CONSTRAINT recurring_series_payment_timing_chk
      CHECK (payment_timing IS NULL OR payment_timing IN ('in_full','in_advance','in_arrears'));
    RAISE NOTICE '  recurring_series_payment_timing_chk added (NULL-tolerant)';
  END IF;
END $$;


-- ─── 2. recurring_payment_schedule — Stripe pointer + retry tracking + status enum extension ──

ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at   TIMESTAMPTZ;

-- EXTEND the existing status CHECK to add 'sent' and 'failed'.
-- Existing enum: pending, paid, overridden, cancelled, overdue
-- New union:    pending, sent, paid, failed, overridden, cancelled, overdue
-- Drop + re-add is the safe idempotent pattern — runs cleanly even if a
-- previous run already extended the enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recurring_payment_schedule_status_check'
       AND conrelid = 'bookings.recurring_payment_schedule'::regclass
  ) THEN
    ALTER TABLE bookings.recurring_payment_schedule
      DROP CONSTRAINT recurring_payment_schedule_status_check;
    RAISE NOTICE '  recurring_payment_schedule_status_check dropped (will re-add extended)';
  END IF;

  ALTER TABLE bookings.recurring_payment_schedule
    ADD CONSTRAINT recurring_payment_schedule_status_check
    CHECK (status IN ('pending','sent','paid','failed','overridden','cancelled','overdue'));
  RAISE NOTICE '  recurring_payment_schedule_status_check added (extended enum: +sent +failed)';
END $$;

-- Cron sweep index — composite on the exact predicate the cron runs daily.
-- Existing indexes: idx_rps_due_date (partial WHERE status='pending'), idx_rps_tenant_status.
-- New index narrows on (due_date, status, tenant_id) which matches the cron's
-- WHERE clause exactly: status='pending' AND due_date <= today (per-tenant).
CREATE INDEX IF NOT EXISTS idx_rps_due_status_tenant
  ON bookings.recurring_payment_schedule(due_date, status, tenant_id);


-- ─── 3. confirmed_bookings.payment_schedule_id — cycle pointer ───────────────
-- Every recurring session is tagged with the cycle it belongs to. ON DELETE
-- SET NULL so schedule-row deletion doesn't cascade into session deletion
-- (sessions are the source of truth for what was booked; cycles are billing artifacts).

ALTER TABLE bookings.confirmed_bookings
  ADD COLUMN IF NOT EXISTS payment_schedule_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'confirmed_bookings_payment_schedule_fk'
       AND conrelid = 'bookings.confirmed_bookings'::regclass
  ) THEN
    ALTER TABLE bookings.confirmed_bookings
      ADD CONSTRAINT confirmed_bookings_payment_schedule_fk
      FOREIGN KEY (payment_schedule_id)
      REFERENCES bookings.recurring_payment_schedule(id)
      ON DELETE SET NULL;
    RAISE NOTICE '  confirmed_bookings_payment_schedule_fk added';
  END IF;
END $$;

-- Partial index — most sessions are not part of a cycle (in_full series + ad-hoc).
CREATE INDEX IF NOT EXISTS idx_cb_payment_schedule
  ON bookings.confirmed_bookings(payment_schedule_id)
  WHERE payment_schedule_id IS NOT NULL;


-- ─── 4. customers — Stripe persistence (off-session billing for in_advance + in_arrears) ──
-- stripe_customer_id is the durable Stripe Customer resource (survives PM rotation).
-- default_payment_method_id is the most-recently-captured card token used for
-- off-session PaymentIntents. Both nullable — cash/BACS customers never get one.

ALTER TABLE bookings.customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id        TEXT,
  ADD COLUMN IF NOT EXISTS default_payment_method_id TEXT;

-- Partial lookup index — Stripe IDs are globally unique but we only constrain
-- WHERE NOT NULL so cash-only customers don't trip the predicate.
CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer
  ON bookings.customers(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;


-- ─── 5. Completion log ───────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 020 v2 complete — per-cycle payment schema extended';
  RAISE NOTICE '  recurring_series: +cycle_length_weeks +card_on_file_at +payment_timing CHECK';
  RAISE NOTICE '  recurring_payment_schedule: +stripe_session_id +attempt_count +last_attempt_at; status enum extended (+sent +failed)';
  RAISE NOTICE '  confirmed_bookings: +payment_schedule_id (FK)';
  RAISE NOTICE '  customers: +stripe_customer_id +default_payment_method_id';
END $$;
