'use strict';

/**
 * LeadDiscoveryService
 * ─────────────────────────────────────────────────────────────────────────────
 * Ports TWO n8n workflows into a single orchestrated Node.js class:
 *
 *   1. "VenueDesk — Lead Discovery (Daily)"  (Wl4HBw8sGpfvTzta.json)
 *      Runs at 06:00 — queries Google Places API, deduplicates, and inserts
 *      raw leads.
 *
 *   2. "VenueDesk — AI Lead Generator (Daily)"  (ElZJaflNkUL51zbk.json)
 *      Runs at 09:00 — fetches new leads, scrapes their websites, calls
 *      OpenAI for venue analysis, saves scores, and sends follow-up emails
 *      to leads that haven't replied after 4 days.
 *
 * The two phases are kept as separate public methods (runDiscovery / runAnalysis)
 * so they can be called independently (e.g. manual trigger endpoint).
 * SchedulerService wires them to cron expressions.
 */

const axios      = require('axios');
const { systemQuery }         = require('../db/pool');
const AIService               = require('./AIService');
const EmailService            = require('./EmailService');
const logger                  = require('./LoggerService');
const { elapsedSec, truncate } = require('../utils/format');

// ── Constants ported from the "Generate Searches" code node ──────────────────

const COUNTIES = [
  'Greater London','Kent','Surrey','Hertfordshire','Essex',
  'Suffolk','Norfolk','Leicestershire','Derbyshire','West Midlands',
  'Worcestershire','West Yorkshire','North Yorkshire','Lancashire',
  'Greater Manchester','Cheshire','County Durham','Northumberland','Dorset','Hampshire',
  'Oxfordshire','Cambridgeshire','Buckinghamshire','Berkshire','Devon',
  'Cornwall','Somerset','Gloucestershire','Wiltshire','Shropshire',
];

const VENUE_TYPES = [
  { q: 'village hall hire',          t: 'Village Hall'      },
  { q: 'community centre room hire', t: 'Community Centre'  },
  { q: 'sports club function room',  t: 'Sports Club'       },
  { q: 'event venue hire',           t: 'Event Venue'       },
  { q: 'church hall hire',           t: 'Community Centre'  },
  { q: 'social club venue hire',     t: 'Sports Club'       },
  { q: 'hotel function room hire',   t: 'Hotel'             },
  { q: 'working mens club hire',     t: 'Sports Club'       },
];

// Chains/retailers to skip — ported from "Parse Google Maps Results"
const SKIP_CHAINS = /tesco|asda|sainsbury|morrisons|costa|starbucks|mcdonalds|pizza|kfc|nando|greggs|boots|lidl|aldi|amazon/i;

const PLACES_API = 'https://places.googleapis.com/v1/places:searchText';

// ─────────────────────────────────────────────────────────────────────────────

class LeadDiscoveryService {

  // ── Phase 1: Google Maps Discovery ────────────────────────────────────────

  /**
   * Daily 06:00 job.
   * Rotates county by day-of-month (same logic as the n8n Code node).
   * Fires one Google Places query per venue type, deduplicates on insert.
   */
  async runDiscovery() {
    const startedAt = Date.now();
    await logger.info('LeadDiscoveryService', 'runDiscovery started');

    const county  = COUNTIES[new Date().getDate() % COUNTIES.length];
    let inserted  = 0;
    let skipped   = 0;
    let errors    = 0;

    for (const vt of VENUE_TYPES) {
      const query = `${vt.q} ${county}`;
      try {
        const places = await this._searchGoogleMaps(query);
        for (const place of places) {
          const saved = await this._insertLeadIfNew(place, vt.t, county);
          saved ? inserted++ : skipped++;
        }
      } catch (err) {
        errors++;
        await logger.error('LeadDiscoveryService', `Search failed: "${query}"`, { error: err.message });
      }
    }

    await logger.info(
      'LeadDiscoveryService',
      `runDiscovery complete — county: ${county}, inserted: ${inserted}, skipped: ${skipped}, errors: ${errors}, elapsed: ${elapsedSec(startedAt)}`
    );

    await systemQuery(
      `INSERT INTO bookings.workflow_audit_log (workflow_name, event, notes)
       VALUES ('LeadDiscoveryService', 'discovery_complete', $1)`,
      [`county=${county} inserted=${inserted} skipped=${skipped} errors=${errors} elapsed=${elapsedSec(startedAt)}`]
    );
  }

  /**
   * Call Google Places Text Search API.
   * Returns an array of normalised place objects.
   */
  async _searchGoogleMaps(textQuery) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');

    const response = await axios.post(
      PLACES_API,
      { textQuery, regionCode: 'GB', languageCode: 'en-GB', maxResultCount: 20 },
      {
        headers: {
          'X-Goog-Api-Key':  apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.id',
          'Content-Type':    'application/json',
        },
        timeout: 20_000,
      }
    );

    const places = response.data?.places ?? [];
    return places
      .map(p => ({
        venue_name:  truncate((p.displayName?.text ?? '').trim(), 120),
        website_url: p.websiteUri        ?? '',
        phone:       p.nationalPhoneNumber ?? '',
        address:     p.formattedAddress  ?? '',
        place_id:    p.id                ?? '',
      }))
      .filter(p => p.venue_name.length >= 3 && !SKIP_CHAINS.test(p.venue_name));
  }

  /**
   * Insert a lead row only if neither website_url nor venue_name already exist.
   * Exact port of the WHERE NOT EXISTS logic from the "Insert Lead" Postgres node.
   *
   * @returns {boolean} true if row was inserted
   */
  async _insertLeadIfNew(place, venueType, county) {
    const notes = truncate(`Google Maps · ${county}${place.address ? ' · ' + place.address : ''}`, 255);

    const result = await systemQuery(
      `INSERT INTO bookings.leads (venue_name, email, website_url, phone, venue_type, status, county, source, notes)
       SELECT $1, '', $2, $3, $4, 'new', $5, 'google_maps', $6
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings.leads WHERE website_url = $2 AND $2 <> ''
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings.leads WHERE lower(venue_name) = lower($7)
       )`,
      [
        place.venue_name,
        place.website_url,
        place.phone,
        venueType,
        county,
        notes,
        truncate(place.venue_name, 50),
      ]
    );

    return result.rowCount > 0;
  }

  // ── Phase 2: AI Scoring & Follow-ups ──────────────────────────────────────

  /**
   * Daily 09:00 job.
   * Scores up to 20 new leads via OpenAI.
   * Sends follow-up emails to up to 10 contacted-but-unreplied leads.
   */
  async runAnalysis() {
    const startedAt = Date.now();
    await logger.info('LeadDiscoveryService', 'runAnalysis started');

    await this._scoreNewLeads();
    await this._sendFollowUps();

    await logger.info('LeadDiscoveryService', `runAnalysis complete — elapsed: ${elapsedSec(startedAt)}`);
  }

  /**
   * Fetch up to 20 unscored leads, scrape each website, and run AI analysis.
   * Ported from: Fetch New Leads → Any new leads? → Fetch Website →
   *              Prepare Analysis Prompt → AI Venue Analysis → Parse Score → Save Score
   */
  async _scoreNewLeads() {
    const { rows: leads } = await systemQuery(
      `SELECT * FROM bookings.leads
       WHERE  status = 'new'
         AND  website_url IS NOT NULL
         AND  website_url <> ''
         AND  website_url NOT LIKE '%example.com%'
         AND  website_url NOT LIKE '%duckduckgo.com%'
       ORDER BY created_at ASC
       LIMIT 20`
    );

    if (!leads.length) {
      await logger.info('LeadDiscoveryService', 'No new leads to score');
      return;
    }

    await logger.info('LeadDiscoveryService', `Scoring ${leads.length} new leads`);

    for (const lead of leads) {
      try {
        // Scrape website HTML (best-effort; timeout after 15s)
        let rawHtml = '';
        try {
          const res = await axios.get(lead.website_url, {
            timeout: 15_000,
            headers: { 'User-Agent': 'VenueDesk-Crawler/2.0' },
            maxContentLength: 500_000,
          });
          rawHtml = String(res.data ?? '');
        } catch {
          // Unreachable website — analyse with empty HTML; still useful for name-based scoring
        }

        const analysis = await AIService.analyseVenue(lead, rawHtml);

        // Save score — ported from "Save Score" Postgres node.
        // Only overwrite email if we scraped one AND the current email is blank / test.
        const testEmail = (process.env.TEST_EMAIL || '').toLowerCase();
        await systemQuery(
          `UPDATE bookings.leads
           SET    ai_score    = $1,
                  ai_analysis = $2,
                  status      = 'scored',
                  email       = CASE
                                  WHEN (email IS NULL OR email = '' OR lower(email) = $3)
                                    AND $4 <> ''
                                  THEN $4
                                  ELSE email
                                END,
                  updated_at  = NOW()
           WHERE  id = $5`,
          [analysis.score, analysis.rawAnalysis, testEmail, analysis.scrapedEmail, lead.id]
        );

        // Audit row — mirrors "Log Score Saved"
        await systemQuery(
          `INSERT INTO bookings.lead_activity (lead_id, type, message)
           VALUES ($1, 'lead_scored', $2)`,
          [lead.id, `AI scored lead: score=${analysis.score}`]
        );

        await logger.info('LeadDiscoveryService', `Scored lead ${lead.id} (${lead.venue_name}) → ${analysis.score}/10`);
      } catch (err) {
        await logger.error('LeadDiscoveryService', `Failed to score lead ${lead.id}`, { error: err.message });
      }
    }
  }

  /**
   * Send follow-up emails to leads that were contacted but haven't replied.
   * Ported from: Fetch Follow-up Leads → Any follow-up leads? →
   *              Prepare Follow-up Prompt → AI Follow-up → Send Follow-up →
   *              Update Follow-up → Log Follow-up
   */
  async _sendFollowUps() {
    const { rows: leads } = await systemQuery(
      `SELECT * FROM bookings.leads
       WHERE  status          = 'contacted'
         AND  reply_received  = FALSE
         AND  last_email_sent_at < NOW() - INTERVAL '4 days'
         AND  follow_up_count < 2
         AND  email IS NOT NULL
       ORDER BY last_email_sent_at ASC
       LIMIT 10`
    );

    if (!leads.length) {
      await logger.info('LeadDiscoveryService', 'No follow-up leads due');
      return;
    }

    await logger.info('LeadDiscoveryService', `Sending ${leads.length} follow-up emails`);

    for (const lead of leads) {
      try {
        const { subject, body } = await AIService.generateFollowUp(lead);

        const sendResult = await EmailService.sendHtml({
          to:      lead.email,
          subject,
          html:    body.replace(/\n/g, '<br>'),
        });

        // Update follow_up_count and last_email_sent_at regardless of send success
        // (prevents tight-loop retries if the SMTP is flaky).
        await systemQuery(
          `UPDATE bookings.leads
           SET    follow_up_count    = follow_up_count + 1,
                  last_email_sent_at = NOW(),
                  status             = CASE WHEN follow_up_count >= 1 THEN 'follow_up' ELSE status END,
                  updated_at         = NOW()
           WHERE  id = $1`,
          [lead.id]
        );

        await systemQuery(
          `INSERT INTO bookings.lead_activity (lead_id, type, message)
           VALUES ($1, 'email_sent', $2)`,
          [lead.id, `Follow-up sent to ${lead.venue_name}${sendResult.success ? '' : ' (SMTP failed)'}`]
        );
      } catch (err) {
        await logger.error('LeadDiscoveryService', `Follow-up failed for lead ${lead.id}`, { error: err.message });
      }
    }
  }
}

module.exports = new LeadDiscoveryService();
