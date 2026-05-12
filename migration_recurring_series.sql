-- ============================================================
-- VenueDesk: recurring_series Parent-Child Migration
-- Run this ONCE against your PostgreSQL database.
-- Then re-import the updated n8n workflow JSON files.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- DB: Step 1 — Create recurring_series
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings.recurring_series (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       INT           NOT NULL,
    customer_id     UUID          NOT NULL REFERENCES bookings.customers(id) ON DELETE CASCADE,
    room_id         UUID          REFERENCES bookings.rooms(id) ON DELETE SET NULL,
    series_name     TEXT          NOT NULL DEFAULT 'Unnamed Series',
    cycle_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
    balance_due     NUMERIC(10,2) NOT NULL DEFAULT 0,
    start_time      TIME,
    end_time        TIME,
    frequency       TEXT          DEFAULT 'weekly',
    start_date      DATE,
    end_date        DATE,
    day_of_week     INT,
    active          BOOLEAN       NOT NULL DEFAULT true,
    payment_timing  VARCHAR(20)   DEFAULT 'in_advance',
    billing_type    TEXT          DEFAULT 'monthly',
    notes           TEXT,
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_series_tenant   ON bookings.recurring_series(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recurring_series_customer ON bookings.recurring_series(customer_id);
SELECT 'recurring_series table ready' AS status;

-- ────────────────────────────────────────────────────────────
-- DB: Step 2 — Add recurring_series_id to confirmed_bookings
-- ────────────────────────────────────────────────────────────
ALTER TABLE bookings.confirmed_bookings
  ADD COLUMN IF NOT EXISTS recurring_series_id UUID REFERENCES bookings.recurring_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cb_recurring_series ON bookings.confirmed_bookings(recurring_series_id) WHERE recurring_series_id IS NOT NULL;
SELECT 'recurring_series_id column ready' AS status;

-- ────────────────────────────────────────────────────────────
-- DB: Step 3 — Migrate recurring_rules → recurring_series
-- ────────────────────────────────────────────────────────────
-- Copy all existing recurring_rules into recurring_series, keeping the same UUID.
-- This lets the FK update in Step 4 work without a mapping table.
-- balance_due is computed from the pending payment schedule entries.
--
-- FIX: Some older recurring_rules rows have customer_id = NULL (created before
-- that column was added). We recover customer_id from linked confirmed_bookings.
-- Rules with no recoverable customer are skipped with a warning query below.
INSERT INTO bookings.recurring_series (
    id, tenant_id, customer_id, room_id, series_name,
    cycle_amount, balance_due,
    start_time, end_time, frequency, end_date, day_of_week,
    active, payment_timing, billing_type, created_at
)
SELECT
    rr.id,
    rr.tenant_id,
    -- Recover customer_id: use the rule's own value, or fall back to any
    -- customer linked via confirmed_bookings (same rule UUID).
    COALESCE(
        rr.customer_id,
        (SELECT cb.customer_id
         FROM   bookings.confirmed_bookings cb
         WHERE  cb.recurring_rule_id = rr.id
           AND  cb.customer_id IS NOT NULL
         ORDER  BY cb.created_at ASC
         LIMIT  1)
    ) AS customer_id,
    rr.room_id,
    COALESCE(NULLIF(rr.series_reference, ''), 'Series-' || SUBSTRING(rr.id::text, 1, 8)),
    COALESCE(NULLIF(rr.agreed_price,   0),
             NULLIF(rr.monthly_fee,    0),
             rr.rate_per_session,
             0),
    COALESCE((
        SELECT SUM(rps.amount_due)
        FROM   bookings.recurring_payment_schedule rps
        WHERE  rps.recurring_rule_id = rr.id
          AND  rps.status = 'pending'
    ), 0),
    rr.start_time,
    rr.end_time,
    COALESCE(rr.frequency, 'weekly'),
    rr.end_date,
    rr.day_of_week,
    COALESCE(rr.active, true),
    COALESCE(rr.payment_timing, 'in_advance'),
    COALESCE(rr.billing_type, 'monthly'),
    rr.created_at
FROM bookings.recurring_rules rr
-- Skip any rule where customer_id is unrecoverable (truly orphaned)
WHERE COALESCE(
    rr.customer_id,
    (SELECT cb.customer_id
     FROM   bookings.confirmed_bookings cb
     WHERE  cb.recurring_rule_id = rr.id
       AND  cb.customer_id IS NOT NULL
     LIMIT  1)
) IS NOT NULL
ON CONFLICT (id) DO NOTHING
RETURNING id, series_name, cycle_amount, balance_due;

-- Show any orphaned rules that were skipped (customer unrecoverable)
SELECT rr.id AS skipped_rule_id, rr.series_reference, rr.tenant_id
FROM   bookings.recurring_rules rr
WHERE  rr.customer_id IS NULL
  AND  NOT EXISTS (
       SELECT 1 FROM bookings.confirmed_bookings cb
       WHERE  cb.recurring_rule_id = rr.id AND cb.customer_id IS NOT NULL
  );

-- ────────────────────────────────────────────────────────────
-- DB: Step 4 — Link bookings + zero child balance_due
-- ────────────────────────────────────────────────────────────
-- Populate recurring_series_id from the existing recurring_rule_id (same UUIDs).
-- Also zero out balance_due on each child session — debt now lives on the parent.
UPDATE bookings.confirmed_bookings
SET    recurring_series_id = recurring_rule_id,
       balance_due         = 0,
       updated_at          = NOW()
WHERE  recurring_rule_id IS NOT NULL
  AND  recurring_series_id IS NULL;

SELECT COUNT(*) AS sessions_migrated
FROM   bookings.confirmed_bookings
WHERE  recurring_series_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- DB: Step 5 — Verification report
-- ────────────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM bookings.recurring_series)    AS series_count,
    (SELECT COUNT(*) FROM bookings.confirmed_bookings WHERE recurring_series_id IS NOT NULL)
                                                         AS linked_sessions,
    (SELECT COUNT(*) FROM bookings.confirmed_bookings WHERE recurring_series_id IS NOT NULL AND balance_due > 0)
                                                         AS child_sessions_with_balance_SHOULD_BE_ZERO,
    (SELECT COALESCE(SUM(balance_due),0) FROM bookings.recurring_series WHERE active = true)
                                                         AS total_series_outstanding,
    (SELECT COALESCE(SUM(balance_due),0) FROM bookings.confirmed_bookings WHERE recurring_series_id IS NULL AND recurring_rule_id IS NULL)
                                                         AS total_single_outstanding;

