-- ═══════════════════════════════════════════════════════════════
-- Migration 004: Cancellation Policy
-- Run once against your PostgreSQL database
-- ═══════════════════════════════════════════════════════════════

-- 1. Add cancellation columns to confirmed_bookings
ALTER TABLE bookings.confirmed_bookings
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_by        TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;

-- 2. Add cancellation columns to payments
ALTER TABLE bookings.payments
    ADD COLUMN IF NOT EXISTS cancellation_booking_ref TEXT,
    ADD COLUMN IF NOT EXISTS cancellation_reason      TEXT,
    ADD COLUMN IF NOT EXISTS refund_type              TEXT;

-- 3. Insert default cancellation policy settings (safe — only if key not present)
-- Note: bookings.settings is a global table with no tenant_id column
INSERT INTO bookings.settings (key, value)
SELECT 'cancel_full_refund_days', '14'
WHERE NOT EXISTS (SELECT 1 FROM bookings.settings WHERE key = 'cancel_full_refund_days');

INSERT INTO bookings.settings (key, value)
SELECT 'cancel_partial_refund_days', '7'
WHERE NOT EXISTS (SELECT 1 FROM bookings.settings WHERE key = 'cancel_partial_refund_days');

INSERT INTO bookings.settings (key, value)
SELECT 'cancel_partial_refund_pct', '50'
WHERE NOT EXISTS (SELECT 1 FROM bookings.settings WHERE key = 'cancel_partial_refund_pct');

-- ═══════════════════════════════════════════════════════════════
-- Done. Re-import AGkUe3zjjFDD0wOL.json in n8n and activate it.
-- ═══════════════════════════════════════════════════════════════
