-- 007_payments_completed_status.sql
-- Adds 'completed' to the valid_payment_status CHECK on bookings.payments.
--
-- Background:
--   The pre-existing constraint allows: pending, received, failed, refunded.
--   Phase 3 record-payment inserts status='completed' for all captured recurring
--   payments. The refund calculation (cancel-series) also queries status='completed'.
--   Without this fix every record-payment call fails with error 23514.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Drop current constraint
  BEGIN
    ALTER TABLE bookings.payments
      DROP CONSTRAINT valid_payment_status;
  EXCEPTION WHEN undefined_object THEN
    NULL; -- already absent
  END;

  -- Re-add with full allowed set (preserves all legacy values)
  BEGIN
    ALTER TABLE bookings.payments
      ADD CONSTRAINT valid_payment_status
      CHECK (status = ANY (ARRAY[
        'pending', 'received', 'failed', 'refunded', 'completed'
      ]));
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- already present
  END;
END $$;
