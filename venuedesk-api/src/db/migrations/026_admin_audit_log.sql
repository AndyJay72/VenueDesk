-- Migration 026 — admin_audit_log + system_health
-- Created: June 2026
-- Purpose: Stores platform-level admin actions from the onboarding dashboard
--          (create_venue, reset_password, toggle_venue) and health-pulse snapshots
--          from the n8n 5-minute cron. Both tables use the system role (no RLS).

-- ── Admin audit log ───────────────────────────────────────────────────────────
-- Rows are written by POST /admin/audit-log (called by n8n after every admin
-- write operation in OnboardingManager). Never modified or deleted via the API.
CREATE TABLE IF NOT EXISTS bookings.admin_audit_log (
    id            BIGSERIAL    PRIMARY KEY,
    admin_id      TEXT         NOT NULL DEFAULT 'super-admin',
    target_tenant INTEGER,
    action_type   TEXT         NOT NULL,
    details       TEXT,
    timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Time-ordered index (primary query pattern: ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
    ON bookings.admin_audit_log (created_at DESC);

-- Tenant filter index (for future per-tenant audit views)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_tenant
    ON bookings.admin_audit_log (target_tenant)
    WHERE target_tenant IS NOT NULL;

-- ── System health pulses ──────────────────────────────────────────────────────
-- Written by POST /health/pulse on every n8n cron tick (*/5 * * * *).
-- Provides a timestamped heartbeat confirming n8n + db-api are both reachable.
CREATE TABLE IF NOT EXISTS bookings.system_health (
    id          BIGSERIAL    PRIMARY KEY,
    source      TEXT         NOT NULL DEFAULT 'n8n-cron',
    status      TEXT         NOT NULL DEFAULT 'ok',
    payload     JSONB,
    recorded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_health_recorded
    ON bookings.system_health (recorded_at DESC);

-- Grant INSERT/SELECT to venuedesk_app so health pulse works via appPool if needed
-- (audit-log writes use systemPool, but harmless to grant here)
GRANT SELECT, INSERT ON bookings.admin_audit_log TO venuedesk_app;
GRANT SELECT, INSERT ON bookings.system_health   TO venuedesk_app;
GRANT USAGE, SELECT ON SEQUENCE bookings.admin_audit_log_id_seq TO venuedesk_app;
GRANT USAGE, SELECT ON SEQUENCE bookings.system_health_id_seq   TO venuedesk_app;
