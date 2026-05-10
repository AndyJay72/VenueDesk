-- 014_stripe_tenant_keys.sql
-- Adds per-tenant Stripe integration columns and BACS bank detail columns
-- to bookings.tenants.
--
-- SECURITY NOTES
-- ──────────────────────────────────────────────────────────────────────────────
-- bookings.tenants is intentionally EXCLUDED from FORCE ROW LEVEL SECURITY
-- (see migration 013 — "DO NOT FORCE: bookings.tenants"). These columns are
-- therefore accessible only via systemQuery (n8n superuser role) inside
-- venuedesk-api. The stripe_secret_key and stripe_webhook_secret columns are
-- NEVER returned from any user-facing API endpoint — only used server-side when
-- initialising the Stripe SDK.
--
-- IDEMPOTENCY
-- All ADD COLUMN statements are guarded with IF NOT EXISTS (PostgreSQL 9.6+).
-- Safe to re-run on any environment.
--
-- DEPLOYMENT ORDER
-- Must run after 005_tenants_table.sql (tenants table predates migration runner).
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Stripe integration columns ────────────────────────────────────────────────
-- stripe_publishable_key : pk_test_... / pk_live_... — safe to expose to frontend
-- stripe_secret_key      : sk_test_... / sk_live_... — NEVER exposed via API
-- stripe_webhook_secret  : whsec_...                 — used for signature verification
-- is_stripe_enabled      : master switch per tenant
ALTER TABLE bookings.tenants
  ADD COLUMN IF NOT EXISTS is_stripe_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_publishable_key TEXT,
  ADD COLUMN IF NOT EXISTS stripe_secret_key      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret  TEXT;

-- ── BACS bank detail columns ──────────────────────────────────────────────────
-- Used in manual/BACS payment email templates — referenced by n8n Financial
-- Operations workflow when building the "Awaiting Payment" email body.
-- Empty strings are valid defaults (shown as "—" in email templates).
ALTER TABLE bookings.tenants
  ADD COLUMN IF NOT EXISTS bacs_account_name   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bacs_sort_code      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bacs_account_number TEXT NOT NULL DEFAULT '';

-- ── booking_status enum expansion ─────────────────────────────────────────────
-- confirmed_bookings.status currently uses open-ended TEXT.
-- Document new lifecycle values introduced by this release:
--   'provisional' — booking created, payment pending (BACS or delayed card)
--   'confirmed'   — Stripe checkout.session.completed received and verified
-- No ALTER TYPE needed — column is TEXT without a CHECK constraint.
-- BillingService ignores 'provisional' bookings in overdue sweeps for 48h
-- (grace period logic is applied in BillingService.js).

-- ── Seed test tenant 1001 with placeholder values ─────────────────────────────
-- Real keys must be set via Admin UI or direct SQL on the VPS.
-- is_stripe_enabled remains FALSE until keys are configured.
-- ── Performance index ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_enabled
  ON bookings.tenants (tenant_id)
  WHERE is_stripe_enabled = TRUE;

-- ── Verification query (run manually after migration) ─────────────────────────
-- SELECT tenant_id, name, is_stripe_enabled,
--        CASE WHEN stripe_secret_key IS NOT NULL THEN 'SET' ELSE 'NULL' END AS secret_status,
--        bacs_sort_code, bacs_account_number, bacs_account_name
-- FROM bookings.tenants
-- ORDER BY tenant_id;
-- ──────────────────────────────────────────────────────────────────────────────
-- Generated: 2026-05-10 | Phase 2 Stripe Multi-Tenant Integration
-- ──────────────────────────────────────────────────────────────────────────────
