-- 013_force_rls.sql
-- PHASE 4b VAULT LOCKDOWN — Apply FORCE ROW LEVEL SECURITY on all tenant tables.
-- ─────────────────────────────────────────────────────────────────────────────
-- PREREQUISITES (must be verified before running ANY step):
--   1. All in-scope n8n workflows report 0 Postgres nodes.
--   2. Test_RecurringSeries.json deleted from n8n and backup folder.
--   3. db-api health check passes: GET https://api.venuedesk.co.uk/health → 200
--   4. Migration 012_outstanding_payments.sql has been applied.
--   5. RLS is already ENABLED on all 12 tables (migration 011_rls_phase4.sql).
--
-- EXECUTION STRATEGY:
--   Run ONE step at a time. Verify after each. Rollback immediately on breakage.
--   Rollback: ALTER TABLE bookings.<table> DISABLE ROW LEVEL SECURITY;
--
-- DO NOT FORCE: bookings.staff_users (login requires cross-tenant lookup)
--               bookings.tenants     (onboarding is cross-tenant by design)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1 — customers ───────────────────────────────────────────────────────
-- Verification: SELECT COUNT(*) FROM bookings.customers;
--               → must return non-zero (tenant 1001 rows only)
ALTER TABLE bookings.customers FORCE ROW LEVEL SECURITY;

-- ── Step 2 — confirmed_bookings ──────────────────────────────────────────────
-- Verification: Dashboard "upcoming bookings" still populates
ALTER TABLE bookings.confirmed_bookings FORCE ROW LEVEL SECURITY;

-- ── Step 3 — booking_requests ────────────────────────────────────────────────
-- Verification: Enquiry form submit succeeds + pending list loads
ALTER TABLE bookings.booking_requests FORCE ROW LEVEL SECURITY;

-- ── Step 4 — payments ────────────────────────────────────────────────────────
-- Verification: Dashboard revenue metric non-zero
ALTER TABLE bookings.payments FORCE ROW LEVEL SECURITY;

-- ── Step 5 — recurring_series ────────────────────────────────────────────────
-- Verification: Recurring bookings dashboard loads
ALTER TABLE bookings.recurring_series FORCE ROW LEVEL SECURITY;

-- ── Step 6 — recurring_rules ─────────────────────────────────────────────────
-- Verification: Booking creation + calendar page functional
ALTER TABLE bookings.recurring_rules FORCE ROW LEVEL SECURITY;

-- ── Step 7 — recurring_payment_schedule ──────────────────────────────────────
-- Verification: PaymentChaser smoke test — due-billing-cycles returns data
ALTER TABLE bookings.recurring_payment_schedule FORCE ROW LEVEL SECURITY;

-- ── Step 8 — outstanding_payments ────────────────────────────────────────────
-- Prerequisite: migration 012_outstanding_payments.sql must have been applied.
-- Verification: No API errors after BillingCycleTrigger manual trigger
ALTER TABLE bookings.outstanding_payments FORCE ROW LEVEL SECURITY;

-- ── Step 9 — customer_interactions ───────────────────────────────────────────
-- Verification: Customer interaction log loads on accounts.html
ALTER TABLE bookings.customer_interactions FORCE ROW LEVEL SECURITY;

-- ── Step 10 — audit_logs ─────────────────────────────────────────────────────
-- Verification: No new errors in db-api logs after FORCE
ALTER TABLE bookings.audit_logs FORCE ROW LEVEL SECURITY;

-- ── Step 11 — rooms ──────────────────────────────────────────────────────────
-- Verification: Room picker in booking form returns rooms
ALTER TABLE bookings.rooms FORCE ROW LEVEL SECURITY;

-- ── Step 12 — add_on_services ────────────────────────────────────────────────
-- Verification: GET /config/services returns add-on data
ALTER TABLE bookings.add_on_services FORCE ROW LEVEL SECURITY;

-- ── Step 13 — cancellations (if exists) ──────────────────────────────────────
-- Added in 003_phase2_tables.sql. Force only if RLS policy exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'bookings' AND tablename = 'cancellations'
  ) THEN
    EXECUTE 'ALTER TABLE bookings.cancellations FORCE ROW LEVEL SECURITY';
    RAISE NOTICE 'FORCE applied to bookings.cancellations';
  ELSE
    RAISE NOTICE 'Skipped bookings.cancellations — no RLS policy defined';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ZERO-TRUST VERIFICATION QUERY
-- Run after all steps. Must return 0 rows for the bypass test.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SET app.tenant_id = '9999';  -- nonexistent tenant
-- SELECT COUNT(*) FROM bookings.customers;          -- must be 0
-- SELECT COUNT(*) FROM bookings.confirmed_bookings; -- must be 0
-- SELECT COUNT(*) FROM bookings.payments;           -- must be 0
-- RESET app.tenant_id;
--
-- FINAL SUCCESS CRITERIA:
--   • All 12 tables show FORCE = true in:
--     SELECT tablename, rowsecurity, forcerowsecurity
--     FROM pg_tables
--     WHERE schemaname = 'bookings'
--     ORDER BY tablename;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Generated: 2026-04-28 | Phase 4b Vault Lockdown
-- Apply only after all Dirty-Ten workflows confirm 0 PG nodes in n8n.
-- ─────────────────────────────────────────────────────────────────────────────
