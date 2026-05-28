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
-- Feature C extension (added 2026-05-27):
--   'cycle' for per-cycle billing rows inserted by stripe.js webhook
--   cycle_id branch and the payment_intent.succeeded off-session handler.
--
--   This migration WAS the source of a crash loop after Test 2 V2 inserted
--   the first payment_type='cycle' rows. PostgreSQL validates ADD CONSTRAINT
--   against existing data; the old 8-value enum rejected those rows on every
--   reboot, crashing migrations before 021 could re-extend the constraint.
--
--   Fix: include 'cycle' here so the round-trip stays idempotent regardless
--   of existing rows. 021 still runs after as a no-op (same enum, drops + re-adds).
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
        'recurring', 'recurring_payment',
        'cycle'
      ]));
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;
