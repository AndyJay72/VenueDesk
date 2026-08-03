-- Migration 029 — add notes column to confirmed_bookings
-- confirmed_bookings was originally created by n8n without a notes column.
-- The /bookings/update route SET notes = COALESCE($6, notes), causing
-- "column notes does not exist" (500) on every booking confirmation.
-- Applied directly on VPS 2026-08-03 via ALTER TABLE; this migration
-- makes it permanent for future container restarts.

ALTER TABLE bookings.confirmed_bookings
  ADD COLUMN IF NOT EXISTS notes TEXT;
