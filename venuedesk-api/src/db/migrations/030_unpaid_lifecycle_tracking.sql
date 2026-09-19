-- Migration 030 — Auto-Cancel Unpaid Bookings Lifecycle
-- Adds:
--   1. bookings.cancellations.category     — distinguishes 'Failed to Pay' vs 'Customer Cancelled'
--   2. bookings.confirmed_bookings.unpaid_warning_sent_at — prevents duplicate warning emails
--   3. Partial index on confirmed_bookings to make the daily lifecycle sweep fast
--   4. Default 'auto_cancel_unpaid_days' setting (value '7')

-- ── 1. category column on cancellations ───────────────────────────────────────
ALTER TABLE bookings.cancellations
  ADD COLUMN IF NOT EXISTS category TEXT;

-- ── 2. warning timestamp on confirmed_bookings ────────────────────────────────
ALTER TABLE bookings.confirmed_bookings
  ADD COLUMN IF NOT EXISTS unpaid_warning_sent_at TIMESTAMPTZ DEFAULT NULL;

-- ── 3. Partial index for the daily sweep ─────────────────────────────────────
-- Covers only rows the lifecycle sweep cares about (open, unpaid).
-- Keeps the daily UPDATE targeted so it never full-scans the table.
CREATE INDEX IF NOT EXISTS idx_cb_unpaid_sweep
  ON bookings.confirmed_bookings (tenant_id, booking_date, date_from, balance_due)
  WHERE status NOT IN ('cancelled', 'fully_paid', 'paid', 'overridden')
    AND balance_due > 0;

-- ── 4. Seed the default setting (global, all tenants share it until overridden)
-- ON CONFLICT DO NOTHING — idempotent on re-run; preserves any existing value.
INSERT INTO bookings.settings (key, value, updated_at)
VALUES ('auto_cancel_unpaid_days', '7', NOW())
ON CONFLICT (key) DO NOTHING;
