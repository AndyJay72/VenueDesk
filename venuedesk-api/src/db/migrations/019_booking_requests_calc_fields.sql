-- Migration 019 — Computed financial fields on booking_requests
-- Closes the null-field gap that was crashing downstream calendar/accounts/
-- audit-log rendering. db-api now computes these on enquiry submission so
-- the row is fully self-describing the moment it lands in the table.
--
-- Columns:
--   total_hours    NUMERIC(5,2) — end_time minus start_time in fractional hrs
--   estimated_cost DECIMAL(10,2) — hours × room.day_rate (calendar-symmetric)
--   deposit_amount DECIMAL(10,2) — what the customer was billed via Stripe
--
-- All ADD COLUMN IF NOT EXISTS — safe to re-run. If these columns exist from
-- an earlier migration not in this repo (the migrations directory only goes
-- back to 004; the canonical schema seed is on the VPS), the guard is a no-op
-- and downstream patches still work because the handler writes to whatever
-- column shape Postgres reports.

ALTER TABLE bookings.booking_requests
  ADD COLUMN IF NOT EXISTS total_hours    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS estimated_cost DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10,2);

-- Index supporting "list deposit-paid enquiries with their amounts" — common
-- on the audit-log + accounts pages once auto-fulfilment is wired in.
-- Partial index keeps it small (most enquiries never reach deposit_paid).
CREATE INDEX IF NOT EXISTS idx_booking_requests_deposit_amount
  ON bookings.booking_requests(tenant_id, deposit_amount)
  WHERE deposit_amount IS NOT NULL AND deposit_amount > 0;

DO $$ BEGIN
  RAISE NOTICE 'Migration 019 complete — booking_requests calc fields (total_hours, estimated_cost, deposit_amount)';
END $$;
