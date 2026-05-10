-- Migration 010: add_on_services table
-- Formalises the table previously created ad-hoc by the n8n Services API workflow.
-- CREATE TABLE IF NOT EXISTS is idempotent — safe to run on production where the
-- table may already exist.

CREATE TABLE IF NOT EXISTS bookings.add_on_services (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  INTEGER      NOT NULL,
  name       TEXT         NOT NULL,
  type       TEXT         NOT NULL DEFAULT 'flat',   -- 'flat' | 'hourly'
  price      DECIMAL(10,2) NOT NULL DEFAULT 0,
  active     BOOLEAN      DEFAULT TRUE,
  created_at TIMESTAMPTZ  DEFAULT NOW(),
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_add_on_services_tenant
  ON bookings.add_on_services (tenant_id);
