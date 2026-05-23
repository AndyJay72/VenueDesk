-- Migration 020 — Per-Cycle Payment Cadence (Feature C)
-- Reference: PER_CYCLE_PAYMENT_DESIGN.md (v2, APPROVED 2026-05-23)
-- Implements the schema half of Feature C:
--   * recurring_series.payment_timing + cycle_length_weeks + card_on_file_at
--   * NEW table bookings.recurring_payment_schedule (RLS-enforced)
--   * confirmed_bookings.payment_schedule_id (FK to schedule rows)
--   * customers.stripe_customer_id + default_payment_method_id (Stripe persistence)
--
-- Idempotent throughout — safe to re-run.
-- Every step guarded by IF NOT EXISTS / DO $$ blocks so a partial prior run
-- cannot wedge the apply.
--
-- Naming: 'payment_timing' (NOT 'payment_cadence') — matches Master System Log
-- §3 canonical vocabulary. Locked decision; do not rename.

-- ─── 0. Parent-table existence preflight ─────────────────────────────────────
-- If any parent table is missing, abort early with a clear message instead of
-- producing a cascade of confusing ALTER errors. Recurring_series is the
-- root dependency — if it's missing the rest of this migration is meaningless.
DO $$
BEGIN
  IF to_regclass('bookings.recurring_series')   IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.recurring_series does not exist — apply the upstream recurring-series migration first'; END IF;
  IF to_regclass('bookings.confirmed_bookings') IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.confirmed_bookings does not exist'; END IF;
  IF to_regclass('bookings.customers')          IS NULL THEN RAISE EXCEPTION 'Migration 020 preflight: bookings.customers does not exist'; END IF;
END $$;


-- ─── 1. recurring_series — payment_timing + cycle_length_weeks + card_on_file_at ──
ALTER TABLE bookings.recurring_series
  ADD COLUMN IF NOT EXISTS payment_timing     TEXT,
  ADD COLUMN IF NOT EXISTS cycle_length_weeks INT,
  ADD COLUMN IF NOT EXISTS card_on_file_at    TIMESTAMPTZ;

-- Default + NOT NULL applied AFTER the column exists, so a pre-existing column
-- with rows is back-filled idempotently.
UPDATE bookings.recurring_series SET payment_timing = 'in_full' WHERE payment_timing IS NULL;

ALTER TABLE bookings.recurring_series
  ALTER COLUMN payment_timing SET DEFAULT 'in_full',
  ALTER COLUMN payment_timing SET NOT NULL;

-- CHECK constraint on payment_timing values — guarded so re-run is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recurring_series_payment_timing_chk'
       AND conrelid = 'bookings.recurring_series'::regclass
  ) THEN
    ALTER TABLE bookings.recurring_series
      ADD CONSTRAINT recurring_series_payment_timing_chk
      CHECK (payment_timing IN ('in_full', 'in_advance', 'in_arrears'));
    RAISE NOTICE '  recurring_series_payment_timing_chk added';
  END IF;
END $$;

-- CHECK constraint on cycle_length_weeks bounds — guarded.
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


-- ─── 2. NEW TABLE — bookings.recurring_payment_schedule ──────────────────────
-- One row per billing cycle. Sessions FK back via confirmed_bookings.payment_schedule_id.
-- Cron sweeps WHERE due_date <= today AND status='scheduled'.
CREATE TABLE IF NOT EXISTS bookings.recurring_payment_schedule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_series_id UUID NOT NULL REFERENCES bookings.recurring_series(id) ON DELETE CASCADE,
  cycle_number        INT  NOT NULL,
  cycle_start_date    DATE NOT NULL,
  cycle_end_date      DATE NOT NULL,
  sessions_count      INT  NOT NULL,
  amount              NUMERIC(10,2) NOT NULL,
  due_date            DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'scheduled',
  stripe_session_id   TEXT NULL,            -- cs_... (Checkout) or pi_... (off-session PaymentIntent)
  paid_at             TIMESTAMPTZ NULL,
  attempt_count       INT  NOT NULL DEFAULT 0,
  last_attempt_at     TIMESTAMPTZ NULL,
  tenant_id           INT  NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recurring_payment_schedule_cycle_unique UNIQUE (recurring_series_id, cycle_number)
);

-- CHECK on status enum — guarded.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'recurring_payment_schedule_status_chk'
       AND conrelid = 'bookings.recurring_payment_schedule'::regclass
  ) THEN
    ALTER TABLE bookings.recurring_payment_schedule
      ADD CONSTRAINT recurring_payment_schedule_status_chk
      CHECK (status IN ('scheduled','sent','paid','failed','overdue','cancelled'));
    RAISE NOTICE '  recurring_payment_schedule_status_chk added';
  END IF;
END $$;

-- Cron sweep index — composite on the exact predicate the cron runs daily.
-- (due_date, status, tenant_id) — RLS guarantees tenant_id filter is always present.
CREATE INDEX IF NOT EXISTS idx_rps_due_status_tenant
  ON bookings.recurring_payment_schedule(due_date, status, tenant_id);

-- Reverse lookup for accounts.html drill-down (one series → all its cycles).
CREATE INDEX IF NOT EXISTS idx_rps_series_cycle
  ON bookings.recurring_payment_schedule(recurring_series_id, cycle_number);


-- ─── 3. RLS on recurring_payment_schedule (follows pattern from migration 015) ──
ALTER TABLE bookings.recurring_payment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bookings.recurring_payment_schedule;

-- missing_ok=TRUE → safe failure (zero rows) when app.tenant_id is unset,
-- never raises. Matches the audit_log pattern exactly.
CREATE POLICY tenant_isolation ON bookings.recurring_payment_schedule
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::int);

ALTER TABLE bookings.recurring_payment_schedule FORCE ROW LEVEL SECURITY;

-- Grant to app role if it exists (mirrors migration 015 idempotency).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'venuedesk_app') THEN
    GRANT SELECT, INSERT, UPDATE ON bookings.recurring_payment_schedule TO venuedesk_app;
    RAISE NOTICE '  Granted SELECT, INSERT, UPDATE on recurring_payment_schedule to venuedesk_app';
  ELSE
    RAISE NOTICE '  venuedesk_app role not found — skipping grant (running as n8n superuser?)';
  END IF;
END $$;


-- ─── 4. confirmed_bookings.payment_schedule_id — cycle pointer ───────────────
-- Every recurring session is tagged with the cycle it belongs to. ON DELETE SET NULL
-- so schedule-row deletion doesn't cascade into session deletion (sessions
-- are the source of truth for what was booked; cycles are a billing artifact).
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

-- Partial index — most sessions are not part of a cycle (in_full series + ad-hoc bookings).
-- Keeps the index small and fast for the "show me cycle 3's sessions" lookup.
CREATE INDEX IF NOT EXISTS idx_cb_payment_schedule
  ON bookings.confirmed_bookings(payment_schedule_id)
  WHERE payment_schedule_id IS NOT NULL;


-- ─── 5. customers — Stripe persistence (in_arrears + in_advance off-session) ──
-- stripe_customer_id is the durable Stripe Customer resource (survives PM rotation).
-- default_payment_method_id is the most-recently-captured card token used for
-- off-session PaymentIntents. Both nullable because cash/BACS customers never get one.
ALTER TABLE bookings.customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id        TEXT,
  ADD COLUMN IF NOT EXISTS default_payment_method_id TEXT;

-- Partial unique-ish lookup index — Stripe customer IDs are globally unique,
-- but we only constrain WHERE NOT NULL so legacy cash customers don't trip the predicate.
CREATE INDEX IF NOT EXISTS idx_customers_stripe_customer
  ON bookings.customers(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;


-- ─── 6. Completion log ───────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Migration 020 complete — per-cycle payment cadence schema in place';
  RAISE NOTICE '  recurring_series: +payment_timing +cycle_length_weeks +card_on_file_at';
  RAISE NOTICE '  recurring_payment_schedule: created with RLS + 2 indexes';
  RAISE NOTICE '  confirmed_bookings: +payment_schedule_id (FK)';
  RAISE NOTICE '  customers: +stripe_customer_id +default_payment_method_id';
END $$;
