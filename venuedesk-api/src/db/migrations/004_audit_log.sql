-- Migration 004 — audit_log table + tenants.is_active guard
-- Safe to run multiple times (IF NOT EXISTS / DO $$ guards throughout)
-- Run via: docker exec -i n8n_postgres-postgres-1 psql -U postgres -d postgres < 004_audit_log.sql

-- ── 1. Ensure bookings.tenants has is_active column ──────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'bookings'
      AND table_name   = 'tenants'
      AND column_name  = 'is_active'
  ) THEN
    ALTER TABLE bookings.tenants ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    RAISE NOTICE 'Added is_active column to bookings.tenants';
  ELSE
    RAISE NOTICE 'bookings.tenants.is_active already exists — skipping';
  END IF;
END $$;

-- Backfill: every existing tenant is active
UPDATE bookings.tenants SET is_active = TRUE WHERE is_active IS NULL;

-- ── 2. audit_log table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings.audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  tenant_id   INT          NOT NULL,
  action      TEXT         NOT NULL,   -- e.g. 'stripe_session_created', 'manual_payment', 'public_stripe_session_created'
  entity      TEXT,                    -- 'booking', 'enquiry', etc.
  entity_id   TEXT,                    -- booking_id or booking_request_id
  payload     JSONB,                   -- { amount, method, booking_request_id, ... }
  staff_user  TEXT,                    -- vp_user_name from JWT (null for public actions)
  source      TEXT,                    -- 'dashboard', 'calendar', 'enquiry-form'
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Index: tenant-scoped time-ordered queries for audit-log.html / accounts.html
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_time
  ON bookings.audit_log (tenant_id, created_at DESC);

-- Index: entity lookups (find all audit events for a specific booking)
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON bookings.audit_log (tenant_id, entity, entity_id);

-- Fix the run command header too
-- Run via: docker exec -i n8n_postgres-postgres-1 psql -U n8n -d bookings_db < 004_audit_log.sql
DO $$ BEGIN RAISE NOTICE 'Migration 004 complete'; END $$;
