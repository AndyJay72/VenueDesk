-- =============================================================================
-- Migration: 001 — Recurring Series Parent-Child Architecture
-- VenueDesk / VenuePro · schema: bookings
-- =============================================================================
-- SAFE TO RUN MULTIPLE TIMES — all statements use IF NOT EXISTS / DO NOTHING.
--
-- This migration formalises the parent-child debt model:
--   recurring_series (PARENT)  ← owns balance_due and configuration
--       ↑  FK
--   confirmed_bookings (CHILD) ← recurring_series_id NOT NULL → balance_due = 0
--
-- Run order matters; do NOT reorder the steps.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0 — Pre-flight: confirm the bookings schema exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'bookings') THEN
        RAISE EXCEPTION 'Schema "bookings" does not exist. Aborting migration.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — Create bookings.recurring_series (parent table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.recurring_series (
    -- Identity
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        INT           NOT NULL,                          -- RLS key
    customer_id      UUID          NOT NULL
                         REFERENCES bookings.customers(id)
                         ON DELETE CASCADE,
    room_id          UUID
                         REFERENCES bookings.rooms(id)
                         ON DELETE SET NULL,

    -- Human-readable label (series_name), e.g. "Yoga Block — Mon 9am"
    series_name      TEXT          NOT NULL DEFAULT 'Unnamed Series',

    -- Scheduling
    frequency        TEXT          NOT NULL DEFAULT 'weekly'         -- weekly | fortnightly | monthly | daily
                         CHECK (frequency IN ('weekly','fortnightly','monthly','daily')),
    day_of_week      INT                                             -- 0=Sun … 6=Sat
                         CHECK (day_of_week BETWEEN 0 AND 6),
    start_time       TIME,
    end_time         TIME,
    start_date       DATE,
    end_date         DATE,

    -- Session economics (locked at contract creation — never recompute from live room rates)
    rate_per_session NUMERIC(10,2) NOT NULL DEFAULT 0,               -- £/session at signing
    sessions_per_cycle INT         NOT NULL DEFAULT 4,               -- sessions per billing cycle
    total_sessions   INT           NOT NULL DEFAULT 0,               -- total sessions in the contract
    sessions_completed INT         NOT NULL DEFAULT 0,               -- updated as sessions pass

    -- Billing
    cycle_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,               -- agreed price per billing cycle
    agreed_price     NUMERIC(10,2) NOT NULL DEFAULT 0,               -- total contract value
    balance_due      NUMERIC(10,2) NOT NULL DEFAULT 0                -- DEBT LIVES HERE, not on children
                         CHECK (balance_due >= 0),
    payment_timing   VARCHAR(20)   NOT NULL DEFAULT 'in_advance'     -- in_advance | in_arrears
                         CHECK (payment_timing IN ('in_advance','in_arrears')),
    billing_type     TEXT          NOT NULL DEFAULT 'monthly'        -- monthly | per_session | upfront

                         CHECK (billing_type IN ('monthly','per_session','upfront')),

    -- Status
    active           BOOLEAN       NOT NULL DEFAULT true,
    notes            TEXT,

    -- Audit
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  bookings.recurring_series IS
    'Parent record for a recurring booking contract. Owns all financial state (balance_due). '
    'Child sessions in confirmed_bookings must have balance_due = 0 when linked here.';

COMMENT ON COLUMN bookings.recurring_series.balance_due IS
    'Total outstanding debt for the entire contract. Child confirmed_bookings rows MUST have '
    'balance_due = 0 when recurring_series_id is set.';

COMMENT ON COLUMN bookings.recurring_series.agreed_price IS
    'Total value of the contract, locked at creation: rate_per_session × total_sessions.';

COMMENT ON COLUMN bookings.recurring_series.rate_per_session IS
    'Per-session rate agreed at contract creation. Never recomputed from live room rates.';

-- ---------------------------------------------------------------------------
-- STEP 2 — Indexes for recurring_series
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rs_tenant
    ON bookings.recurring_series(tenant_id);

CREATE INDEX IF NOT EXISTS idx_rs_customer
    ON bookings.recurring_series(customer_id);

CREATE INDEX IF NOT EXISTS idx_rs_active_tenant
    ON bookings.recurring_series(tenant_id, active)
    WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_rs_balance_outstanding
    ON bookings.recurring_series(tenant_id, balance_due)
    WHERE balance_due > 0 AND active = true;

-- ---------------------------------------------------------------------------
-- STEP 3 — Add recurring_series_id FK to confirmed_bookings
-- ---------------------------------------------------------------------------
ALTER TABLE bookings.confirmed_bookings
    ADD COLUMN IF NOT EXISTS recurring_series_id UUID
        REFERENCES bookings.recurring_series(id)
        ON DELETE SET NULL;

-- Covering index: look up all sessions in a series efficiently
CREATE INDEX IF NOT EXISTS idx_cb_recurring_series_id
    ON bookings.confirmed_bookings(recurring_series_id)
    WHERE recurring_series_id IS NOT NULL;

-- Partial index: sessions that still have non-zero balance (shouldn't happen in the new arch)
CREATE INDEX IF NOT EXISTS idx_cb_series_outstanding
    ON bookings.confirmed_bookings(recurring_series_id, balance_due)
    WHERE recurring_series_id IS NOT NULL AND balance_due > 0;

-- ---------------------------------------------------------------------------
-- STEP 4 — Trigger: enforce balance_due = 0 on child sessions
-- ---------------------------------------------------------------------------
-- Any INSERT or UPDATE on confirmed_bookings that sets recurring_series_id
-- to a non-NULL value MUST have balance_due = 0. The trigger auto-corrects
-- rather than raising an error, so existing bulk inserts keep working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bookings.fn_zero_child_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- If this booking is a child of a recurring series, debt lives on the parent.
    IF NEW.recurring_series_id IS NOT NULL THEN
        NEW.balance_due := 0;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zero_child_balance ON bookings.confirmed_bookings;

CREATE TRIGGER trg_zero_child_balance
    BEFORE INSERT OR UPDATE OF recurring_series_id, balance_due
    ON bookings.confirmed_bookings
    FOR EACH ROW
    EXECUTE FUNCTION bookings.fn_zero_child_balance();

COMMENT ON FUNCTION bookings.fn_zero_child_balance() IS
    'Automatically zeros balance_due on any confirmed_bookings row that has a '
    'recurring_series_id. Debt for recurring sessions lives on recurring_series.balance_due.';

-- ---------------------------------------------------------------------------
-- STEP 5 — Updated-at trigger for recurring_series
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bookings.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rs_updated_at ON bookings.recurring_series;

CREATE TRIGGER trg_rs_updated_at
    BEFORE UPDATE ON bookings.recurring_series
    FOR EACH ROW
    EXECUTE FUNCTION bookings.fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- STEP 6 — Backfill: add missing columns to recurring_series (idempotent)
-- These columns may be absent if the table was created by an earlier migration.
-- ---------------------------------------------------------------------------
ALTER TABLE bookings.recurring_series
    ADD COLUMN IF NOT EXISTS rate_per_session  NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sessions_per_cycle INT          NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS total_sessions     INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sessions_completed INT          NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS agreed_price       NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Backfill agreed_price from cycle_amount where it's zero (best estimate from old data)
UPDATE bookings.recurring_series
SET    agreed_price = cycle_amount
WHERE  agreed_price = 0
  AND  cycle_amount > 0;

-- Backfill rate_per_session from cycle_amount / sessions_per_cycle where zero
UPDATE bookings.recurring_series
SET    rate_per_session = CASE
           WHEN sessions_per_cycle > 0 THEN ROUND(cycle_amount / sessions_per_cycle, 2)
           ELSE cycle_amount
       END
WHERE  rate_per_session = 0
  AND  cycle_amount > 0;

-- ---------------------------------------------------------------------------
-- STEP 7 — Link existing recurring_rule_id → recurring_series_id (backfill)
-- The UUIDs are identical after the migration in Migration_RecurringSeries.json.
-- Zero out child balance_due as the trigger now enforces going forward.
-- ---------------------------------------------------------------------------
UPDATE bookings.confirmed_bookings
SET    recurring_series_id = recurring_rule_id,
       balance_due         = 0,
       updated_at          = NOW()
WHERE  recurring_rule_id   IS NOT NULL
  AND  recurring_series_id IS NULL;

-- ---------------------------------------------------------------------------
-- STEP 8 — Pay-balance safety view
--
-- A lightweight view that always returns the CORRECT outstanding balance for
-- any booking, routing to the parent series when applicable.
-- Used by the balance service and any reporting queries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW bookings.v_booking_balance AS
SELECT
    cb.id                                    AS booking_id,
    cb.tenant_id,
    cb.customer_id,
    cb.recurring_series_id,
    cb.total_amount,
    cb.status,
    CASE
        -- Child of a recurring series → debt lives on the parent
        WHEN cb.recurring_series_id IS NOT NULL THEN
            COALESCE(
                (SELECT rs.balance_due
                 FROM   bookings.recurring_series rs
                 WHERE  rs.id        = cb.recurring_series_id
                   AND  rs.tenant_id = cb.tenant_id),
                0
            )
        -- Standard single booking → debt is booking-level
        ELSE
            COALESCE(cb.balance_due, 0)
    END                                      AS effective_balance_due,
    CASE
        WHEN cb.recurring_series_id IS NOT NULL THEN 'recurring_series'
        ELSE 'booking'
    END                                      AS balance_source
FROM bookings.confirmed_bookings cb;

COMMENT ON VIEW bookings.v_booking_balance IS
    'Safe balance lookup for any booking. For recurring children, returns the parent '
    'series balance_due. For single bookings, returns the row-level balance_due.';

-- ---------------------------------------------------------------------------
-- STEP 9 — Verification report (inspect after running)
-- ---------------------------------------------------------------------------
SELECT
    'recurring_series rows'                                        AS metric,
    COUNT(*)::text                                                 AS value
FROM bookings.recurring_series
UNION ALL
SELECT
    'confirmed_bookings with recurring_series_id',
    COUNT(*)::text
FROM bookings.confirmed_bookings
WHERE recurring_series_id IS NOT NULL
UNION ALL
SELECT
    'child sessions with balance_due > 0 (MUST BE 0)',
    COUNT(*)::text
FROM bookings.confirmed_bookings
WHERE recurring_series_id IS NOT NULL
  AND balance_due > 0
UNION ALL
SELECT
    'total outstanding on recurring_series (£)',
    COALESCE(SUM(balance_due),0)::text
FROM bookings.recurring_series
WHERE active = true
UNION ALL
SELECT
    'total outstanding on single bookings (£)',
    COALESCE(SUM(balance_due),0)::text
FROM bookings.confirmed_bookings
WHERE recurring_series_id IS NULL
  AND recurring_rule_id   IS NULL
  AND balance_due         > 0
UNION ALL
SELECT
    'trigger fn_zero_child_balance exists',
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'bookings' AND p.proname = 'fn_zero_child_balance'
    ) THEN 'YES ✓' ELSE 'MISSING ✗' END;
