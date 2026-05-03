-- =============================================================================
-- Migration 014 — Grant table permissions to venuedesk_app role
-- =============================================================================
-- Root cause of 42501 (insufficient_privilege):
--   venuedesk_app was created in docker-compose but never granted any
--   permissions on the bookings schema or its tables. Every INSERT/UPDATE/
--   SELECT executed via withTenantContext (appPool) was failing at the
--   privilege check BEFORE RLS was even evaluated.
--
-- This is a GRANT issue, not an RLS issue. ALTER ROLE ... BYPASSRLS would
-- not fix this — BYPASSRLS only skips the RLS policy filter; it cannot
-- substitute for missing table-level privileges.
--
-- The n8n user (POSTGRES_USER) is a superuser and already bypasses all
-- permission checks. These grants apply only to venuedesk_app (appPool).
-- =============================================================================

-- Schema access
GRANT USAGE ON SCHEMA bookings TO venuedesk_app;

-- Core tenant tables — full DML (RLS enforces row visibility)
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.customers               TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.confirmed_bookings      TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.booking_requests        TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.payments                TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.recurring_series        TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.recurring_rules         TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.recurring_payment_schedule TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.outstanding_payments    TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.customer_interactions   TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.audit_logs              TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.rooms                   TO venuedesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.add_on_services         TO venuedesk_app;

-- staff_users — SELECT only (auth reads; writes go through superuser pool)
GRANT SELECT ON bookings.staff_users TO venuedesk_app;

-- tenants — SELECT only (onboarding uses systemPool, not appPool)
GRANT SELECT ON bookings.tenants TO venuedesk_app;

-- Sequence usage for any serial/identity columns
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bookings TO venuedesk_app;

-- Future tables created in this schema inherit the grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA bookings
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO venuedesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA bookings
  GRANT USAGE, SELECT ON SEQUENCES TO venuedesk_app;

-- =============================================================================
-- Verification query (run after applying):
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'venuedesk_app' AND table_schema = 'bookings'
--   ORDER BY table_name, privilege_type;
-- Expected: 4 rows per table (SELECT, INSERT, UPDATE, DELETE)
-- =============================================================================
