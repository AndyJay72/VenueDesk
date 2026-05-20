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

-- Idempotent type recast: if total_hours exists from an earlier deploy as
-- INTEGER (which truncates 2.5h → 2), promote it to NUMERIC(5,2). Runs only
-- when the current type is in the integer family — otherwise no-op.
-- The USING clause forces a value-preserving cast (2 → 2.00, 1 → 1.00).
DO $$
DECLARE
    current_type text;
BEGIN
    SELECT data_type INTO current_type
      FROM information_schema.columns
     WHERE table_schema = 'bookings'
       AND table_name   = 'booking_requests'
       AND column_name  = 'total_hours';
    IF current_type IN ('integer', 'smallint', 'bigint') THEN
        ALTER TABLE bookings.booking_requests
          ALTER COLUMN total_hours TYPE NUMERIC(5,2)
          USING total_hours::numeric(5,2);
        RAISE NOTICE '  total_hours recast: % → NUMERIC(5,2)', current_type;
    END IF;
END $$;

-- Same recast for estimated_cost + deposit_amount on the off-chance they were
-- ever provisioned as INTEGER or REAL — DECIMAL(10,2) is the canonical type.
DO $$
DECLARE
    col record;
BEGIN
    FOR col IN
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'bookings'
           AND table_name   = 'booking_requests'
           AND column_name IN ('estimated_cost', 'deposit_amount')
    LOOP
        IF col.data_type IN ('integer', 'smallint', 'bigint', 'real', 'double precision') THEN
            EXECUTE format(
              'ALTER TABLE bookings.booking_requests ALTER COLUMN %I TYPE DECIMAL(10,2) USING %I::decimal(10,2)',
              col.column_name, col.column_name
            );
            RAISE NOTICE '  % recast: % → DECIMAL(10,2)', col.column_name, col.data_type;
        END IF;
    END LOOP;
END $$;

-- Index supporting "list deposit-paid enquiries with their amounts" — common
-- on the audit-log + accounts pages once auto-fulfilment is wired in.
-- Partial index keeps it small (most enquiries never reach deposit_paid).
CREATE INDEX IF NOT EXISTS idx_booking_requests_deposit_amount
  ON bookings.booking_requests(tenant_id, deposit_amount)
  WHERE deposit_amount IS NOT NULL AND deposit_amount > 0;

DO $$ BEGIN
  RAISE NOTICE 'Migration 019 complete — booking_requests calc fields (total_hours, estimated_cost, deposit_amount)';
END $$;
