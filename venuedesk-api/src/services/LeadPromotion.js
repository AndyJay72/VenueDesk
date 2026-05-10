'use strict';

/**
 * LeadPromotion — atomic Lead → Prospect promotion.
 * ─────────────────────────────────────────────────────────────────────────────
 * Ports the "VenueDesk — API: Update Lead Status" workflow (LeadsUpdateWF.json)
 * into a single atomic DB transaction.
 *
 * n8n execution chain being replaced:
 *   Webhook → IF: Is Hot Prospect?
 *               → [YES] DB: Ensure Prospects Table
 *                        → DB: Insert Prospect
 *                        → DB: Update Status → Respond: OK
 *               → [NO]  DB: Update Status → Respond: OK
 *
 * The "Ensure Prospects Table" node is eliminated — migrate.js handles DDL at boot.
 *
 * This function is used by:
 *   - POST /leads/:id/status  (route handler)
 *   - Any future internal caller that needs to promote a lead
 *
 * @param {string} leadId   - UUID of the lead row
 * @param {string} newStatus - e.g. 'hot_prospect', 'scored', 'contacted'
 * @returns {Promise<{ lead_id: string, status: string, prospect_id?: number }>}
 */

const { systemQuery }               = require('../db/pool');
const logger                        = require('./LoggerService');
const { assertUUID, assertLeadStatus } = require('../utils/validators');
const { notFound }                  = require('../utils/errors');

async function promoteLead(leadId, newStatus) {
  assertUUID(leadId, 'leadId');
  assertLeadStatus(newStatus, 'status');

  const isHotProspect = newStatus === 'hot_prospect';

  if (isHotProspect) {
    return _promoteToHotProspect(leadId, newStatus);
  }

  return _updateStatusOnly(leadId, newStatus);
}

/**
 * Hot-prospect path — atomic: INSERT INTO prospects + UPDATE leads.status
 * Uses a CTE so both writes succeed or both roll back together.
 * Ported from: "DB: Insert Prospect" + "DB: Update Status".
 */
async function _promoteToHotProspect(leadId, newStatus) {
  const { rows } = await systemQuery(
    `WITH upsert AS (
       INSERT INTO bookings.prospects (lead_id, venue_name, contact_name, email, phone, website_url, ai_score, status)
       SELECT  id, venue_name, contact_name, email, phone, website_url, ai_score, 'ready_for_onboarding'
       FROM    bookings.leads
       WHERE   id = $1::uuid
       ON CONFLICT (lead_id) DO NOTHING
       RETURNING id AS prospect_id
     ),
     update_lead AS (
       UPDATE bookings.leads
       SET    status     = $2,
              updated_at = NOW()
       WHERE  id = $1::uuid
       RETURNING id AS lead_id, status
     )
     SELECT ul.lead_id::text, ul.status, u.prospect_id
     FROM   update_lead ul
     LEFT   JOIN upsert u ON TRUE`,
    [leadId, newStatus]
  );

  if (!rows.length) {
    throw notFound('Lead', leadId);
  }

  await logger.info(
    'LeadPromotion',
    `Lead promoted to hot_prospect`,
    { leadId, prospectId: rows[0].prospect_id }
  );

  return {
    lead_id:    rows[0].lead_id,
    status:     rows[0].status,
    prospect_id: rows[0].prospect_id ?? null,
  };
}

/**
 * Standard status update — no prospect insertion.
 * Ported from the "DB: Update Status" node (non-hot-prospect branch).
 */
async function _updateStatusOnly(leadId, newStatus) {
  const { rows } = await systemQuery(
    `UPDATE bookings.leads
     SET    status     = $2,
            updated_at = NOW()
     WHERE  id = $1::uuid
     RETURNING id::text AS lead_id, status`,
    [leadId, newStatus]
  );

  if (!rows.length) {
    throw notFound('Lead', leadId);
  }

  await logger.info('LeadPromotion', `Lead status updated`, { leadId, newStatus });

  return {
    lead_id: rows[0].lead_id,
    status:  rows[0].status,
  };
}

module.exports = { promoteLead };
