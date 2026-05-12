-- ============================================================
-- Migration 006: Recurring Rule Frequency & End Date
-- Adds frequency (weekly/fortnightly/monthly) and optional
-- end_date to recurring_rules so the ghost-booking generator
-- knows how often to create slots.
-- Run once: paste into n8n Postgres node → Execute Query mode.
-- ============================================================

-- 1. Add frequency column (defaults to weekly for existing rows)
ALTER TABLE bookings.recurring_rules
    ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'weekly'
        CHECK (frequency IN ('weekly','fortnightly','monthly'));

-- 2. Add optional end date for the rule (NULL = runs indefinitely)
ALTER TABLE bookings.recurring_rules
    ADD COLUMN IF NOT EXISTS end_date DATE;

-- Index to help the generator query find active rules by date
CREATE INDEX IF NOT EXISTS idx_recurring_rules_end_date
    ON bookings.recurring_rules(tenant_id, end_date)
    WHERE end_date IS NOT NULL;
