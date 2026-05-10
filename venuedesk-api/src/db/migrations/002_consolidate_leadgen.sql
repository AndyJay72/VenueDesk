-- =============================================================================
--  Migration 002 — Consolidate Lead-Gen into the bookings schema
-- =============================================================================
--
--  Context
--  ───────
--  The original n8n lead-gen workflow used a SEPARATE PostgreSQL connection
--  ("Postgres account 3") that landed leads/prospects in the public schema
--  (or a separate database entirely).
--
--  This migration pulls those three tables into the bookings schema so the
--  entire VenueDesk platform uses a single DATABASE_URL.
--
--  Tables created
--  ──────────────
--    bookings.leads          — raw venue leads from Google Maps / manual entry
--    bookings.lead_activity  — audit trail for every lead action
--    bookings.prospects      — hot-prospect staging (promoted from leads)
--
--  Safety
--  ──────
--  All statements are idempotent (IF NOT EXISTS).  Running this migration
--  on an existing database will never destroy data.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  bookings.leads
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.leads (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identity (from Google Maps / manual)
  venue_name        TEXT          NOT NULL,
  email             TEXT          NOT NULL DEFAULT '',
  website_url       TEXT          NOT NULL DEFAULT '',
  phone             TEXT          NOT NULL DEFAULT '',
  venue_type        TEXT,
  county            TEXT,
  source            TEXT          NOT NULL DEFAULT 'google_maps',
  notes             TEXT,

  -- AI enrichment (populated by daily 09:00 job)
  contact_name      TEXT,
  place_id          TEXT,                             -- Google Place ID (dedup key)
  ai_score          INTEGER       CHECK (ai_score BETWEEN 1 AND 10),
  ai_analysis       TEXT,

  -- Status FSM
  -- Valid values match LEAD_STATUSES in src/utils/validators.js:
  --   new | scored | contacted | follow_up | hot_prospect | onboarded | disqualified
  status            TEXT          NOT NULL DEFAULT 'new',

  -- Follow-up tracking (updated by LeadDiscoveryService._sendFollowUps)
  reply_received    BOOLEAN       NOT NULL DEFAULT FALSE,
  last_email_sent_at TIMESTAMPTZ,
  follow_up_count   INTEGER       NOT NULL DEFAULT 0,

  tenant_id         INTEGER       NOT NULL DEFAULT current_setting('app.tenant_id', TRUE)::INTEGER,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Dedup indexes (mirror the WHERE NOT EXISTS logic in _insertLeadIfNew)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_website_url
  ON bookings.leads (lower(website_url))
  WHERE website_url <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_venue_name_lower
  ON bookings.leads (lower(venue_name));

CREATE INDEX IF NOT EXISTS idx_leads_status
  ON bookings.leads (status);

CREATE INDEX IF NOT EXISTS idx_leads_tenant
  ON bookings.leads (tenant_id);


-- -----------------------------------------------------------------------------
--  bookings.lead_activity
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.lead_activity (
  id          BIGSERIAL     PRIMARY KEY,
  lead_id     UUID          NOT NULL REFERENCES bookings.leads (id) ON DELETE CASCADE,
  type        TEXT          NOT NULL,   -- e.g. lead_scored | email_sent | status_changed
  message     TEXT,
  tenant_id   INTEGER       NOT NULL DEFAULT current_setting('app.tenant_id', TRUE)::INTEGER,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_id
  ON bookings.lead_activity (lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_activity_created_at
  ON bookings.lead_activity (created_at DESC);


-- -----------------------------------------------------------------------------
--  bookings.prospects
-- -----------------------------------------------------------------------------
--  NOTE: lead_id is UUID — this prevents the implicit integer-cast errors that
--  occurred in the original n8n "Insert Prospect" Postgres node which typed
--  lead_id as INT and then tried to assign a UUID string.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings.prospects (
  id            SERIAL        PRIMARY KEY,
  lead_id       UUID          UNIQUE NOT NULL REFERENCES bookings.leads (id) ON DELETE CASCADE,
  venue_name    TEXT,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  website_url   TEXT,
  ai_score      INTEGER       CHECK (ai_score BETWEEN 1 AND 10),
  status        TEXT          NOT NULL DEFAULT 'ready_for_onboarding',
  notes         TEXT,
  tenant_id     INTEGER       NOT NULL DEFAULT current_setting('app.tenant_id', TRUE)::INTEGER,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_status
  ON bookings.prospects (status);

CREATE INDEX IF NOT EXISTS idx_prospects_tenant
  ON bookings.prospects (tenant_id);
