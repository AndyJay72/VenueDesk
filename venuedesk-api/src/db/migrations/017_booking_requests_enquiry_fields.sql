-- Migration 017 — Enquiry form extra columns on booking_requests
-- Adds hire_type, total_cost, event_type, notes so the public enquiry endpoint
-- can record the full submission without data loss.
-- All ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE bookings.booking_requests
  ADD COLUMN IF NOT EXISTS hire_type  TEXT CHECK (hire_type IN ('hourly', 'full_day')),
  ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS notes      TEXT;

-- Ensure unique constraint on customers(email, tenant_id) so the public
-- enquiry endpoint can upsert a customer without a race condition.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname      = 'customers_email_tenant_uq'
       AND conrelid     = 'bookings.customers'::regclass
  ) THEN
    ALTER TABLE bookings.customers
      ADD CONSTRAINT customers_email_tenant_uq UNIQUE (email, tenant_id);
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 017 complete — booking_requests enquiry fields + customers unique constraint';
END $$;
