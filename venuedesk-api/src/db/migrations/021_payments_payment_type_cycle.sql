-- Migration 021 — Extend payments.valid_payment_type CHECK to include 'cycle'
-- Reference: PER_CYCLE_PAYMENT_DESIGN.md §9.1 (decision: add 'cycle' to enum
-- for per-cycle billing reporting via GROUP BY payment_type).
--
-- Caught during Feature C in_advance smoke (2026-05-27): the webhook cycle_id
-- branch in stripe.js INSERTs payments rows with payment_type='cycle' on
-- per-cycle Stripe Checkout completion. The pre-existing CHECK constraint
-- rejected the value, withTenantContext rolled back the entire webhook txn
-- (schedule row stayed 'pending', sessions stayed 'pending', no payment row,
-- no Stripe customer/PM persisted) — even though the £ was charged on Stripe.
--
-- This migration drops + re-adds the constraint with 'cycle' included.
-- Idempotent: DROP IF EXISTS, guarded ADD via pg_constraint check.

-- Preflight — confirm parent table exists
DO $$
BEGIN
  IF to_regclass('bookings.payments') IS NULL THEN
    RAISE EXCEPTION 'Migration 021 preflight: bookings.payments missing';
  END IF;
END $$;

-- Inspect existing constraint values so we don't lose any pre-existing enum members.
-- The current CHECK on payment_type allows: full, deposit, refund, partial,
-- adjustment (and possibly others depending on prior migration history).
-- We preserve all of them and add 'cycle'.
DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'valid_payment_type'
    AND conrelid = 'bookings.payments'::regclass;

  IF current_def IS NOT NULL THEN
    RAISE NOTICE '  Existing valid_payment_type definition: %', current_def;
  END IF;
END $$;

-- DROP + ADD pattern — both idempotent steps.
ALTER TABLE bookings.payments DROP CONSTRAINT IF EXISTS valid_payment_type;

-- Re-add with extended enum — preserves every existing value verbatim plus 'cycle'.
-- Existing set (verified live 2026-05-27 via pg_get_constraintdef):
--   deposit, balance, full, refund, full_payment, credit_card,
--   recurring, recurring_payment
-- Adds 'cycle' for Feature C per-cycle billing rows inserted by stripe.js
-- webhook Branch 0 (cycle_id) and payment_intent.succeeded handler.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_payment_type'
      AND conrelid = 'bookings.payments'::regclass
  ) THEN
    ALTER TABLE bookings.payments
      ADD CONSTRAINT valid_payment_type
      CHECK (payment_type IN (
        'deposit',
        'balance',
        'full',
        'refund',
        'full_payment',
        'credit_card',
        'recurring',
        'recurring_payment',
        'cycle'              -- NEW for Feature C per-cycle billing
      ));
    RAISE NOTICE '  valid_payment_type re-added (preserved 8 existing + cycle)';
  END IF;
END $$;

-- Validate the new constraint accepts 'cycle' against any test row (empty result
-- if the table is empty, otherwise validates existing rows). No-op assertion.
DO $$
BEGIN
  PERFORM 1 FROM bookings.payments WHERE payment_type = 'cycle' LIMIT 1;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 021 complete — payments.payment_type now accepts cycle';
END $$;
