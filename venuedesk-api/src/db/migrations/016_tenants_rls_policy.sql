-- Migration 016 — RLS policy for bookings.tenants
-- RLS was enabled on bookings.tenants (intentionally not FORCED — superuser
-- bypass required for onboarding and cross-tenant admin). However no policy
-- existed, causing venuedesk_app (non-superuser) to receive zero rows on
-- every tenant lookup, breaking all stripe.js and auth config endpoints.

DROP POLICY IF EXISTS tenant_isolation ON bookings.tenants;

CREATE POLICY tenant_isolation ON bookings.tenants
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::int);

DO $$ BEGIN RAISE NOTICE 'Migration 016 complete — tenants RLS policy applied'; END $$;
