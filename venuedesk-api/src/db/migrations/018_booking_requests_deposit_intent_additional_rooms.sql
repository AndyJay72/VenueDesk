-- Migration 018 — Multi-room + deposit-isolation columns on booking_requests
-- Adds:
--   deposit_intent   BOOLEAN — separates free enquiry (false) from Stripe-deposit
--                              enquiry (true). Lets staff dashboards / n8n tell
--                              "abandoned mid-Stripe" rows from genuine free
--                              requests without inferring it from absence.
--   additional_rooms JSONB   — calendar.html qb-card multi-room parity. Each
--                              element: { id, name, day_rate }. Primary room
--                              still lives in room_id; this array supplements.
--
-- ALL ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE bookings.booking_requests
  ADD COLUMN IF NOT EXISTS deposit_intent   BOOLEAN DEFAULT FALSE       NOT NULL,
  ADD COLUMN IF NOT EXISTS additional_rooms JSONB   DEFAULT '[]'::jsonb NOT NULL;

-- Partial index — only for the (small) subset of rows where deposit_intent=true.
-- Supports dashboard queries like "show pending_deposit enquiries awaiting
-- Stripe webhook return for this tenant". Full table scans on the other
-- 99% of rows skip the index entirely.
CREATE INDEX IF NOT EXISTS idx_booking_requests_deposit_intent
  ON bookings.booking_requests(tenant_id, status)
  WHERE deposit_intent = TRUE;

DO $$ BEGIN
  RAISE NOTICE 'Migration 018 complete — booking_requests.deposit_intent + additional_rooms';
END $$;
