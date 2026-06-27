-- 028_add_room_hierarchy.sql
-- Self-referential parent_room_id + fractional partition metadata.
-- Enables divisible venue spaces: Main Hall → North Half, South Half, etc.
-- Clash checking in bookings.js expands via recursive CTE to block
-- ancestors, descendants, and spatially-overlapping siblings automatically.

ALTER TABLE bookings.rooms
  ADD COLUMN IF NOT EXISTS parent_room_id  UUID
    REFERENCES bookings.rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partition_order INTEGER,  -- 0-based position: 0 = 1st half/third/quarter
  ADD COLUMN IF NOT EXISTS partition_total INTEGER;  -- total equal parts at this level: 2/3/4

-- Efficient ancestor/descendant traversal
CREATE INDEX IF NOT EXISTS idx_rooms_parent_room
  ON bookings.rooms(parent_room_id)
  WHERE parent_room_id IS NOT NULL;

-- Prevent a room from being its own direct parent
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_no_self_parent'
      AND table_schema    = 'bookings'
      AND table_name      = 'rooms'
  ) THEN
    ALTER TABLE bookings.rooms
      ADD CONSTRAINT chk_no_self_parent CHECK (id <> parent_room_id);
  END IF;
END $$;

-- Partition fields must be null together or both valid:
-- if set, total >= 2; order is 0-based and strictly < total.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_partition_consistency'
      AND table_schema    = 'bookings'
      AND table_name      = 'rooms'
  ) THEN
    ALTER TABLE bookings.rooms
      ADD CONSTRAINT chk_partition_consistency CHECK (
        (partition_order IS NULL AND partition_total IS NULL)
        OR (
          partition_order IS NOT NULL
          AND partition_total IS NOT NULL
          AND partition_total >= 2
          AND partition_order >= 0
          AND partition_order < partition_total
        )
      );
  END IF;
END $$;
