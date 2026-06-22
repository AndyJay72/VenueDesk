-- Migration 024: Add open_time / close_time columns to bookings.rooms
-- Replaces the sessionStorage-only vp_room_hours_<tid> pattern with proper DB persistence.
-- Idempotent: wrapped in DO $$ IF NOT EXISTS block.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'bookings'
      AND  table_name   = 'rooms'
      AND  column_name  = 'open_time'
  ) THEN
    ALTER TABLE bookings.rooms
      ADD COLUMN open_time  TIME DEFAULT '08:00:00',
      ADD COLUMN close_time TIME DEFAULT '17:00:00';
  END IF;
END $$;
