-- ============================================================
-- Migration 005: Recurring Memberships
-- Run once against PostgreSQL (paste into n8n Postgres node,
-- Execute Query mode, then click Test Step).
-- ============================================================

-- ── 1. MEMBERSHIPS ──────────────────────────────────────────
-- One row per customer membership plan.
-- policy_template links to membership_policy_templates.code
-- (A = standard one-off, B = recurring, C = community/charity)
CREATE TABLE IF NOT EXISTS bookings.memberships (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           INT         NOT NULL,
    customer_id         UUID        NOT NULL REFERENCES bookings.customers(id) ON DELETE CASCADE,
    plan_name           TEXT        NOT NULL,
    policy_template     TEXT        NOT NULL DEFAULT 'B',   -- A | B | C
    monthly_rate        NUMERIC(10,2),                       -- headline monthly price shown on invoices
    status              TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','paused','cancelled')),
    start_date          DATE        NOT NULL,
    end_date            DATE,                                 -- NULL = open-ended
    notice_period_days  INT         NOT NULL DEFAULT 30,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant    ON bookings.memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_customer  ON bookings.memberships(customer_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status    ON bookings.memberships(tenant_id, status);

-- ── 2. RECURRING RULES ──────────────────────────────────────
-- One row per room/timeslot combination within a membership.
-- e.g. "Main Hall every Wednesday 18:00-20:00"
-- The n8n generator reads active rules and "explodes" them into
-- individual confirmed_booking rows 1 month ahead (ghost strategy).
CREATE TABLE IF NOT EXISTS bookings.recurring_rules (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           INT         NOT NULL,
    membership_id       UUID        NOT NULL REFERENCES bookings.memberships(id) ON DELETE CASCADE,
    room_id             UUID        NOT NULL REFERENCES bookings.rooms(id),
    day_of_week         INT         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
                                                -- 0=Sunday … 6=Saturday
    start_time          TIME        NOT NULL,
    end_time            TIME        NOT NULL,
    rate_per_session    NUMERIC(10,2),           -- NULL = derive from monthly_rate / sessions
    active              BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_rules_membership ON bookings.recurring_rules(membership_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_room       ON bookings.recurring_rules(room_id);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_active     ON bookings.recurring_rules(tenant_id, active);

-- ── 3. EXTEND confirmed_bookings FOR RECURRING ──────────────
-- Tag ghost bookings so the calendar/availability logic works
-- without any extra conflict-checking code.
ALTER TABLE bookings.confirmed_bookings
    ADD COLUMN IF NOT EXISTS recurring_rule_id  UUID REFERENCES bookings.recurring_rules(id),
    ADD COLUMN IF NOT EXISTS membership_id      UUID REFERENCES bookings.memberships(id),
    ADD COLUMN IF NOT EXISTS is_recurring       BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cb_recurring_rule ON bookings.confirmed_bookings(recurring_rule_id)
    WHERE recurring_rule_id IS NOT NULL;

-- ── 4. MEMBERSHIP POLICY TEMPLATES ──────────────────────────
-- Per-tenant policy text. Fetched by n8n and appended to emails.
-- Seeded with sensible defaults; admin-config.html lets staff edit.
CREATE TABLE IF NOT EXISTS bookings.membership_policy_templates (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       INT     NOT NULL,
    code            TEXT    NOT NULL,       -- A | B | C
    name            TEXT    NOT NULL,
    base_terms      TEXT    NOT NULL,
    extra_clauses   TEXT,                   -- appended for recurring confirmation emails
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, code)
);

-- Default seed — replace 1001 with your actual tenant_id if different,
-- or insert per-tenant rows from admin-config.html.
INSERT INTO bookings.membership_policy_templates (tenant_id, code, name, base_terms, extra_clauses)
VALUES
  (1001, 'A', 'Standard (One-off)',
   'Booking is subject to standard venue terms and conditions. Full payment is required prior to the event date.',
   NULL),
  (1001, 'B', 'Recurring Member',
   'This booking is part of an active membership agreement. Standard venue terms and conditions apply.',
   'Recurring memberships require a minimum of 30 days written notice to cancel or pause. Failure to provide adequate notice will result in the next month''s session fees remaining due. The venue reserves the right to reallocate the slot with equivalent notice.'),
  (1001, 'C', 'Community / Charity',
   'This booking is made under the Community & Charity rate. Discounted pricing applies. No overnight storage of equipment or materials is permitted without prior written consent.',
   'Community bookings require 30 days written notice to cancel. Discounted rates are conditional on continued charitable status — the venue reserves the right to review pricing annually.')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 5. VENUE CONFIG ─────────────────────────────────────────
-- Per-tenant key/value store for venue-level settings
-- (billing day, invoice preference, reminder lead time, etc.)
CREATE TABLE IF NOT EXISTS bookings.venue_config (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   INT     NOT NULL,
    key         TEXT    NOT NULL,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, key)
);

-- Seed invoice preference defaults
INSERT INTO bookings.venue_config (tenant_id, key, value)
VALUES
  (1001, 'recurring_invoice_mode',    'monthly'),   -- 'monthly' | 'per_session'
  (1001, 'recurring_billing_day',     '1'),          -- day of month to generate invoice
  (1001, 'recurring_reminder_days',   '7'),          -- days before session to send reminder
  (1001, 'recurring_generate_months', '1'),          -- how many months ahead to generate
  (1001, 'recurring_notice_days',     '30')          -- membership cancellation notice period
ON CONFLICT (tenant_id, key) DO NOTHING;

-- ── 6. MONTHLY INVOICES TABLE ────────────────────────────────
-- Best-practice: one invoice per member per month, line items per session.
-- Individual sessions still get bookings.payments rows (per-session receipts).
CREATE TABLE IF NOT EXISTS bookings.membership_invoices (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       INT         NOT NULL,
    membership_id   UUID        NOT NULL REFERENCES bookings.memberships(id),
    customer_id     UUID        NOT NULL REFERENCES bookings.customers(id),
    invoice_month   DATE        NOT NULL,       -- first day of the invoiced month
    total_amount    NUMERIC(10,2) NOT NULL,
    amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
    balance_due     NUMERIC(10,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
    status          TEXT        NOT NULL DEFAULT 'unpaid'
                        CHECK (status IN ('unpaid','paid','partial','waived')),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_date        DATE        NOT NULL,
    paid_at         TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (membership_id, invoice_month)
);

CREATE INDEX IF NOT EXISTS idx_mi_tenant    ON bookings.membership_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mi_customer  ON bookings.membership_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_mi_status    ON bookings.membership_invoices(tenant_id, status);
