-- ============================================================
-- Migration 007: Standalone Recurring Bookings
-- Decouples recurring_rules from memberships so recurring
-- bookings can be created directly from the booking forms
-- without requiring a membership plan.
--
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards).
-- Run: paste into n8n Postgres node → Execute Query → Test Step.
-- ============================================================

-- ── 1. Make membership_id nullable in recurring_rules ────────
-- Previously NOT NULL; recurring bookings created directly
-- from the booking form don't need a membership.
ALTER TABLE bookings.recurring_rules
    ALTER COLUMN membership_id DROP NOT NULL;

-- ── 2. Add customer_id directly to recurring_rules ───────────
-- Needed when there is no membership to look the customer up from.
ALTER TABLE bookings.recurring_rules
    ADD COLUMN IF NOT EXISTS customer_id UUID
        REFERENCES bookings.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_rules_customer
    ON bookings.recurring_rules(customer_id)
    WHERE customer_id IS NOT NULL;

-- ── 3. Make day_of_week nullable ─────────────────────────────
-- daily frequency doesn't use a specific weekday.
ALTER TABLE bookings.recurring_rules
    ALTER COLUMN day_of_week DROP NOT NULL;

-- ── 4. Add 'daily' to the frequency check constraint ─────────
ALTER TABLE bookings.recurring_rules
    DROP CONSTRAINT IF EXISTS recurring_rules_frequency_check;

ALTER TABLE bookings.recurring_rules
    ADD CONSTRAINT recurring_rules_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'fortnightly', 'monthly'));

-- ── 5. Create recurring_payment_schedule ─────────────────────
-- One row per billing period (month) per recurring series.
-- Tracks whether the customer has paid for that month's slots.
-- The auto-cancel workflow queries due_date + status = 'pending'
-- to cancel unpaid series after 7 days.
CREATE TABLE IF NOT EXISTS bookings.recurring_payment_schedule (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         INT         NOT NULL,
    recurring_rule_id UUID        NOT NULL
        REFERENCES bookings.recurring_rules(id) ON DELETE CASCADE,
    customer_id       UUID        NOT NULL
        REFERENCES bookings.customers(id),
    period_start      DATE        NOT NULL,     -- first day of the billed month
    period_end        DATE        NOT NULL,     -- last day of the billed month
    amount_due        NUMERIC(10,2) NOT NULL DEFAULT 0,
    due_date          DATE        NOT NULL,     -- payment must arrive by this date
    status            TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'overridden', 'cancelled')),
    override_by       TEXT,                     -- staff member who granted override
    override_note     TEXT,
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (recurring_rule_id, period_start)    -- one entry per month per series
);

CREATE INDEX IF NOT EXISTS idx_rps_tenant
    ON bookings.recurring_payment_schedule(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rps_rule
    ON bookings.recurring_payment_schedule(recurring_rule_id);
CREATE INDEX IF NOT EXISTS idx_rps_status
    ON bookings.recurring_payment_schedule(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rps_due_date
    ON bookings.recurring_payment_schedule(due_date, status)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_rps_customer
    ON bookings.recurring_payment_schedule(customer_id);

-- ── 6. Extend confirmed_bookings with series_label ───────────
-- Short human-readable label shown in badges: "Weekly", "Monthly" etc.
-- Populated by create-recurring-booking workflow.
ALTER TABLE bookings.confirmed_bookings
    ADD COLUMN IF NOT EXISTS series_label TEXT;
