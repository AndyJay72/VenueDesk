-- 005_tenants_table.sql
-- bookings.tenants already exists in this deployment with columns:
--   tenant_id (PK), venue_id, name, slug, active, created_at
-- Seeded tenants: 1 (System Admin), 1001 (Test Venue), 1002, 1003
--
-- This migration is intentionally minimal — the table predates this migration
-- runner. Only the performance index is managed here.
--
-- Re-running this file is always safe (fully idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- Index: service queries filter on active tenants via:
--   SELECT tenant_id FROM bookings.tenants WHERE active = TRUE
CREATE INDEX IF NOT EXISTS idx_tenants_active
  ON bookings.tenants (active)
  WHERE active = TRUE;
