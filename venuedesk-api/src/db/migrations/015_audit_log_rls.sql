-- Migration 015 — RLS + FORCE on bookings.audit_log
-- The audit_log table was created in 004_audit_log.sql but RLS was never applied.
-- Aligns it with the other 12 protected tenant tables.
-- Safe to re-run (DO $$ guards throughout).

-- ── 1. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE bookings.audit_log ENABLE ROW LEVEL SECURITY;

-- ── 2. Drop policy if it already exists (idempotent) ──────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON bookings.audit_log;

-- ── 3. Tenant isolation policy ────────────────────────────────────────────────
-- current_setting with missing_ok=TRUE returns NULL (not error) when
-- app.tenant_id is unset — safe-failure by design (returns zero rows).
CREATE POLICY tenant_isolation ON bookings.audit_log
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::int);

-- ── 4. Force RLS (applies even to table owner) ────────────────────────────────
ALTER TABLE bookings.audit_log FORCE ROW LEVEL SECURITY;

-- ── 5. Grant venuedesk_app access (INSERT + SELECT) ──────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'venuedesk_app') THEN
    GRANT SELECT, INSERT ON bookings.audit_log TO venuedesk_app;
    RAISE NOTICE 'Granted SELECT, INSERT on bookings.audit_log to venuedesk_app';
  ELSE
    RAISE NOTICE 'venuedesk_app role not found — skipping grant';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'Migration 015 complete — audit_log RLS enforced'; END $$;
