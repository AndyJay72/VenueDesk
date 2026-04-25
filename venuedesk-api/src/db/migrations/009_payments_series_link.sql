-- 009_payments_series_link.sql
-- Adds recurring_series_id to bookings.payments so the Phase 3 record-payment
-- handler can link a payment row back to its recurring_series without the
-- UPDATE failing (which aborts the transaction and silently breaks schedule seeding).
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bookings.payments
  ADD COLUMN IF NOT EXISTS recurring_series_id UUID
    REFERENCES bookings.recurring_series(id) ON DELETE SET NULL;

-- Index for lookup by series (payment history per series)
CREATE INDEX IF NOT EXISTS idx_payments_recurring_series
  ON bookings.payments(recurring_series_id)
  WHERE recurring_series_id IS NOT NULL;
