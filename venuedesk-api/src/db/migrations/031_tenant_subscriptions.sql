-- Migration 031: Subscription CRM columns on bookings.tenants
-- Adds subscription_status and max_users so the onboarding dashboard
-- can display and manage per-venue plan information.
-- active_users is derived at query time (COUNT from staff_users) — not stored.

ALTER TABLE bookings.tenants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT    DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS max_users           INTEGER DEFAULT 5;
