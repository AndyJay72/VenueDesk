-- 008_payments_recurring_type.sql
-- Adds 'recurring' and 'recurring_payment' to the valid_payment_type CHECK
-- on bookings.payments.
--
-- Background:
--   The pre-existing constraint allows: deposit, balance, full, refund,
--   full_payment, credit_card.
--   Phase 3 record-payment writes payment_type='recurring'.
--   Legacy n8n workflows wrote 'recurring_payment' — included here so
--   accounts.html's ledger filter (which accepts both) matches real rows.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    ALTER TABLE bookings.payments
      DROP CONSTRAINT valid_payment_type;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE bookings.payments
      ADD CONSTRAINT valid_payment_type
      CHECK (payment_type = ANY (ARRAY[
        'deposit', 'balance', 'full', 'refund',
        'full_payment', 'credit_card',
        'recurring', 'recurring_payment'
      ]));
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
