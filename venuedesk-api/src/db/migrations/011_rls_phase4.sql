-- =============================================================================
-- Migration 011 — Row-Level Security Phase 4 (ENABLE only)
-- =============================================================================
-- This migration enables RLS on all tenant-scoped tables and creates isolation
-- policies. It does NOT issue FORCE yet — FORCE is a separate step (Phase 4b)
-- that must be deferred until all n8n Postgres nodes have been replaced with
-- HTTP calls to the db-api.
--
-- Safe-failure design: current_setting('app.tenant_id', TRUE) returns NULL
-- when the setting is not present (the TRUE flag suppresses the error).
-- NULL::int comparisons always return FALSE → 0 rows returned, no crash.
--
-- withTenantContext() in pool.js calls:
--   SELECT set_config('app.tenant_id', $1::text, true)
-- inside every user-facing transaction, satisfying all policies below.
--
-- Service-role (scheduler/chaser) uses withServiceContext() which does NOT set
-- app.tenant_id. Service routes must include explicit WHERE tenant_id = ...
-- filters. They are safe here because FORCE is not yet enabled.
-- =============================================================================

-- ─── Helper: create policy only if it doesn't already exist ──────────────────
-- Postgres lacks IF NOT EXISTS on CREATE POLICY, so we use a DO block.

DO $$
DECLARE
  tbl TEXT;
BEGIN

  -- ──────────────────────────────────────────────────────────────────────────
  -- Tables receiving ENABLE + policy (standard tenant-scoped tables)
  -- ──────────────────────────────────────────────────────────────────────────
  FOREACH tbl IN ARRAY ARRAY[
    'customers',
    'confirmed_bookings',
    'booking_requests',
    'payments',
    'recurring_series',
    'recurring_rules',
    'recurring_payment_schedule',
    'outstanding_payments',
    'customer_interactions',
    'audit_logs',
    'rooms',
    'add_on_services'
  ]
  LOOP
    EXECUTE format('ALTER TABLE bookings.%I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop then re-create so re-running the migration is idempotent
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON bookings.%I', tbl);

    EXECUTE format(
      $pol$
        CREATE POLICY tenant_isolation_policy ON bookings.%I
          FOR ALL
          USING (
            tenant_id = current_setting('app.tenant_id', TRUE)::int
          )
      $pol$,
      tbl
    );

    RAISE NOTICE 'RLS ENABLE + policy applied to bookings.%', tbl;
  END LOOP;

  -- ──────────────────────────────────────────────────────────────────────────
  -- staff_users — ENABLE only, no FORCE.
  -- Login queries this table by username BEFORE a tenant context is set
  -- (chicken-and-egg: need username→tenant_id lookup to set the context).
  -- Policy is created but NOT forced; user rows are visible to the db-api
  -- connection because withTenantContext is set for post-auth operations.
  -- ──────────────────────────────────────────────────────────────────────────
  ALTER TABLE bookings.staff_users ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation_policy ON bookings.staff_users;
  -- Permissive policy: allow when tenant context matches OR when no context
  -- is set (login path). The login route sets context after the initial lookup.
  CREATE POLICY tenant_isolation_policy ON bookings.staff_users
    FOR ALL
    USING (
      current_setting('app.tenant_id', TRUE) IS NULL
      OR current_setting('app.tenant_id', TRUE) = ''
      OR tenant_id = current_setting('app.tenant_id', TRUE)::int
    );
  RAISE NOTICE 'RLS ENABLE + permissive policy applied to bookings.staff_users';

  -- ──────────────────────────────────────────────────────────────────────────
  -- tenants — ENABLE only, NO policy.
  -- Used by onboarding routes which are cross-tenant by design (raw pool,
  -- X-Admin-Key auth). A tenant_isolation_policy would block all onboarding
  -- operations. No policy = table behaves as if RLS is disabled for now.
  -- ──────────────────────────────────────────────────────────────────────────
  ALTER TABLE bookings.tenants ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation_policy ON bookings.tenants;
  -- No policy created intentionally — see note above.
  RAISE NOTICE 'RLS ENABLE (no policy) applied to bookings.tenants — cross-tenant table';

END $$;


-- =============================================================================
-- PHASE 4b — FORCE RLS (DO NOT RUN UNTIL PHASE 2 SQL PURGE IS COMPLETE)
-- =============================================================================
-- Once ALL n8n Postgres nodes have been migrated to HTTP calls, run:
--
-- ALTER TABLE bookings.customers              FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.confirmed_bookings     FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.booking_requests       FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.payments               FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.recurring_series       FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.recurring_rules        FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.recurring_payment_schedule FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.outstanding_payments   FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.customer_interactions  FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.audit_logs             FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.rooms                  FORCE ROW LEVEL SECURITY;
-- ALTER TABLE bookings.add_on_services        FORCE ROW LEVEL SECURITY;
--
-- DO NOT FORCE: bookings.staff_users (login path), bookings.tenants (cross-tenant)
--
-- Rollback if anything breaks:
-- ALTER TABLE bookings.<table> DISABLE ROW LEVEL SECURITY;
-- =============================================================================
