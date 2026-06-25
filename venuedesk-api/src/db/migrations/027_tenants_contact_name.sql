-- Migration 027: add contact_name to bookings.tenants
-- Decouples the admin-panel "contact name" field from staff_users.full_name.
-- Venues provisioned without a staff user (e.g. manually) previously had no
-- way to persist a contact name. contact_name stores it directly on the tenant
-- row. GET /onboarding/venues reads COALESCE(t.contact_name, u.full_name) so
-- existing venues with staff users continue to display correctly.

ALTER TABLE bookings.tenants
  ADD COLUMN IF NOT EXISTS contact_name TEXT;
