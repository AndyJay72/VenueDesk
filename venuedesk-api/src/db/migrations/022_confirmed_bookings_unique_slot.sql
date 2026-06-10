-- Migration 022 — Unique constraint on confirmed_bookings(room_id, booking_date, start_time, end_time)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Root cause: /bookings/create uses a SELECT-then-INSERT clash check (check-then-act). Under
-- concurrent load, two requests can both pass the SELECT (no existing booking found) before
-- either commits the INSERT, producing duplicate bookings for the same room/date/time slot.
-- Reproduced live during QA June 2026: 5 concurrent threads all received HTTP 200 for the
-- same slot.
--
-- Fix: partial unique index on the four natural key columns. The WHERE clause excludes rows
-- with status IN ('cancelled') so that a slot can be rebooked after a soft-status cancellation
-- (note: the cancel route hard-DELETEs rows, but /bookings/update can set status='cancelled'
-- without deleting, so the guard is defensive).
--
-- When two concurrent INSERTs race, the second one will receive PostgreSQL error 23505
-- (unique_violation). The /bookings/create route catches 23505 and returns HTTP 409 — the
-- same response as a normal clash-check failure.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS is a no-op on re-run.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ── Preflight ────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('bookings.confirmed_bookings') IS NULL THEN
    RAISE EXCEPTION 'Migration 022 preflight: bookings.confirmed_bookings does not exist';
  END IF;
END $$;

-- ── Defensive deduplication ───────────────────────────────────────────────────────────────────────
-- Remove duplicate rows before adding the constraint. Keeps the oldest row per
-- (room_id, booking_date, start_time, end_time) group (lowest id = earliest insert).
-- No-op when the table has no duplicates (normal case).
DO $$
DECLARE
  v_removed bigint := 0;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY room_id, booking_date, start_time, end_time
             ORDER BY id
           ) AS rn
    FROM bookings.confirmed_bookings
    WHERE status NOT IN ('cancelled')
  ),
  deleted AS (
    DELETE FROM bookings.confirmed_bookings
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_removed FROM deleted;

  IF v_removed > 0 THEN
    RAISE WARNING 'Migration 022: removed % duplicate confirmed_booking row(s) before adding unique constraint', v_removed;
  ELSE
    RAISE NOTICE 'Migration 022: no duplicate rows found — deduplication step was a no-op';
  END IF;
END $$;

-- ── Unique index ──────────────────────────────────────────────────────────────────────────────────
-- Partial: excludes rows with status='cancelled' (soft-cancelled via /bookings/update).
-- Hard-cancelled rows are already deleted from this table by the cancel route.
-- Not CONCURRENTLY: table is small and the migration runner does not wrap statements in
-- an explicit transaction, so the brief table lock is acceptable and safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_bookings_room_slot
  ON bookings.confirmed_bookings (room_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled');

-- ── Verification ─────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'bookings'
      AND tablename  = 'confirmed_bookings'
      AND indexname  = 'idx_confirmed_bookings_room_slot'
  ) INTO v_exists;

  IF v_exists THEN
    RAISE NOTICE 'Migration 022 complete — idx_confirmed_bookings_room_slot is active';
  ELSE
    RAISE EXCEPTION 'Migration 022 verification failed — index was not created';
  END IF;
END $$;
