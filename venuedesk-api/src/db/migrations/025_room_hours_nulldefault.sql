-- Migration 025: change open_time/close_time defaults to NULL and reset
-- existing rows so enforcement only triggers when hours are explicitly set.
--
-- Migration 024 used DEFAULT '08:00:00'/'17:00:00'. That means all existing
-- rooms carry a 17:00 close_time that would immediately break evening bookings
-- if the API enforced hours. NULL = unconstrained (venue-wide window applies).

DO $$ BEGIN
  -- Drop the literal defaults so new rooms without explicit hours get NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'bookings' AND table_name = 'rooms' AND column_name = 'open_time'
  ) THEN
    ALTER TABLE bookings.rooms
      ALTER COLUMN open_time  SET DEFAULT NULL,
      ALTER COLUMN close_time SET DEFAULT NULL;

    -- Reset rows that still carry the migration-024 placeholder defaults.
    -- Rooms explicitly configured by a manager will already have been updated
    -- to different values via the Config → Rooms form and are left untouched.
    UPDATE bookings.rooms
    SET open_time  = NULL,
        close_time = NULL
    WHERE open_time  = '08:00:00'
      AND close_time = '17:00:00';
  END IF;
END $$;
