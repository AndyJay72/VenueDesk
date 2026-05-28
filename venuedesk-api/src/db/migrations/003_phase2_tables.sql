-- =============================================================================
-- Migration 003 — Phase 2 API tables
-- Safe to run multiple times — all statements use IF NOT EXISTS / DO NOTHING.
--
-- Creates tables required by the Phase 2 venuedesk-api endpoints:
--   bookings.cancellations  — audit trail for cancelled bookings
--   bookings.audit_logs     — CLAUDE.md §2.7 write-operation audit trail
-- =============================================================================

-- ---------------------------------------------------------------------------
-- bookings.cancellations
-- Mirrors the n8n "DB: Ensure Cancellations Schema" node from AGkUe3zjjFDD0wOL.
-- All DELETE-from-confirmed_bookings flows INSERT here instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.cancellations (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            INTEGER     NOT NULL,
    original_booking_id  UUID        NOT NULL,
    customer_id          UUID        NOT NULL,
    room_id              UUID,
    booking_date         DATE,
    date_from            DATE,
    date_to              DATE,
    start_time           TIME,
    end_time             TIME,
    total_amount         NUMERIC(10,2) DEFAULT 0,
    deposit_paid         NUMERIC(10,2) DEFAULT 0,
    balance_due          NUMERIC(10,2) DEFAULT 0,
    series_reference     TEXT,
    recurring_series_id  UUID,
    recurring_rule_id    UUID,
    is_recurring         BOOLEAN     NOT NULL DEFAULT FALSE,
    reason               TEXT,
    cancelled_by         TEXT,
    cancelled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    refund_amount        NUMERIC(10,2) DEFAULT 0,
    refund_type          TEXT,
    original_status      TEXT        NOT NULL DEFAULT 'confirmed',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cancellations_tenant
    ON bookings.cancellations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_cancellations_customer
    ON bookings.cancellations(customer_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_cancellations_series
    ON bookings.cancellations(series_reference)
    WHERE series_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cancellations_original
    ON bookings.cancellations(original_booking_id);

-- ---------------------------------------------------------------------------
-- bookings.audit_logs
-- CLAUDE.md §2.7: every write operation must produce a structured audit entry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.audit_logs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    INTEGER     NOT NULL,
    action       TEXT        NOT NULL,  -- 'CREATE' | 'UPDATE' | 'CANCEL' | 'PAYMENT'
    entity       TEXT        NOT NULL,  -- 'booking' | 'customer' | 'recurring_series' | ...
    entity_id    TEXT,                  -- UUID of the affected row (as text for flexibility)
    payload      JSONB,                 -- full context object for forensic replay
    performed_by TEXT,                  -- user_id from JWT or 'system'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant
    ON bookings.audit_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
    ON bookings.audit_logs(entity, entity_id)
    WHERE entity_id IS NOT NULL;

COMMENT ON TABLE bookings.audit_logs IS
    'CLAUDE.md §2.7 — Immutable audit trail for all write operations. '
    'Rows are INSERT-only; never UPDATE or DELETE this table.';
