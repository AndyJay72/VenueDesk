-- Migration 023: policy_templates
-- Stores per-tenant membership policy text for the three template types (A/B/C).
-- Upserted by (tenant_id, code) — one row per template per tenant.

CREATE TABLE IF NOT EXISTS bookings.policy_templates (
    id            serial       PRIMARY KEY,
    tenant_id     integer      NOT NULL,
    code          char(1)      NOT NULL CHECK (code IN ('A','B','C')),
    name          text         NOT NULL,
    base_terms    text         NOT NULL DEFAULT '',
    extra_clauses text,
    updated_at    timestamptz  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_policy_templates_tenant
    ON bookings.policy_templates (tenant_id);

ALTER TABLE bookings.policy_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'bookings'
      AND tablename  = 'policy_templates'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON bookings.policy_templates FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::integer);
  END IF;
END $$;

ALTER TABLE bookings.policy_templates FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON bookings.policy_templates TO venuedesk_app;

GRANT USAGE, SELECT
    ON SEQUENCE bookings.policy_templates_id_seq TO venuedesk_app;
