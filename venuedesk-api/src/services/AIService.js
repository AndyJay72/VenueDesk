'use strict';

const OpenAI = require('openai');
const logger = require('./LoggerService');

/**
 * AIService — OpenAI SDK wrapper.
 *
 * Replaces @n8n/n8n-nodes-langchain.openAi nodes from
 * VenueDesk — AI Lead Generator (Daily).
 *
 * Two public methods:
 *   analyseVenue(lead, websiteHtml)   → { score, venue_type, key_feature, pain_point, tone, scrapedEmail }
 *   generateFollowUp(lead)            → { subject, body }
 */

const SKIP_EMAIL = /noreply|no-reply|privacy|legal|info@example|webmaster|support@|admin@/i;
const EMAIL_RE   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const TEST_EMAIL = (process.env.TEST_EMAIL || '').toLowerCase();

let _client;
function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Scrape the first usable contact email from raw HTML.
 * Ported from the "Prepare Analysis Prompt" code node.
 */
function scrapeEmailFromHtml(html) {
  EMAIL_RE.lastIndex = 0;
  let match;
  while ((match = EMAIL_RE.exec(html)) !== null) {
    const candidate = match[0].toLowerCase();
    if (!SKIP_EMAIL.test(candidate) && candidate !== TEST_EMAIL) {
      return candidate;
    }
  }
  return '';
}

/**
 * Analyse a venue lead from its website content.
 * Ported 1:1 from: Prepare Analysis Prompt → AI Venue Analysis → Parse Score.
 *
 * @param {object} lead    - Row from the `leads` table
 * @param {string} rawHtml - Raw HTML body fetched from lead.website_url
 * @returns {Promise<{ score: number, venue_type: string, key_feature: string, pain_point: string, tone: string, scrapedEmail: string, rawAnalysis: string }>}
 */
async function analyseVenue(lead, rawHtml = '') {
  const scrapedEmail  = scrapeEmailFromHtml(rawHtml);
  const websiteSnippet = rawHtml.length > 0 ? rawHtml.substring(0, 2000) : 'No website available';
  const venueName      = lead.venue_name || 'the venue';

  const prompt = [
    'Analyse this venue for VenueDesk CRM outreach.',
    'Respond ONLY with valid JSON: {"score":<1-10>,"venue_type":"<type>","key_feature":"<one sentence>","pain_point":"<one sentence>","tone":"<formal|friendly>"}',
    `Venue: ${venueName}`,
    `Website content (first 2000 chars): ${websiteSnippet}`,
  ].join('\n');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const completion = await getClient().chat.completions.create({
      model,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawAnalysis = completion.choices[0]?.message?.content ?? '';
    let parsed = { score: 5 };
    try {
      parsed = JSON.parse(rawAnalysis.replace(/^```json\n?|```$/g, ''));
    } catch {
      await logger.warn('AIService', `Could not parse analysis JSON for lead ${lead.id}`, { rawAnalysis });
    }

    return {
      score:        parsed.score        ?? 5,
      venue_type:   parsed.venue_type   ?? '',
      key_feature:  parsed.key_feature  ?? '',
      pain_point:   parsed.pain_point   ?? '',
      tone:         parsed.tone         ?? 'friendly',
      scrapedEmail,
      rawAnalysis,
    };
  } catch (err) {
    await logger.error('AIService', `analyseVenue failed for lead ${lead.id}`, { error: err.message });
    return { score: 5, venue_type: '', key_feature: '', pain_point: '', tone: 'friendly', scrapedEmail, rawAnalysis: '' };
  }
}

/**
 * Generate a follow-up email for a previously contacted lead.
 * Ported from: Prepare Follow-up Prompt → AI Follow-up.
 *
 * @param {object} lead - Row from `leads` (must have venue_name, contact_name)
 * @returns {Promise<{ subject: string, body: string }>}
 */
async function generateFollowUp(lead) {
  const contactName = lead.contact_name || 'there';
  const venueName   = lead.venue_name   || 'the venue';

  const prompt = [
    'Write a brief, friendly follow-up email for VenueDesk. Maximum 2 paragraphs, not pushy.',
    'The email MUST:',
    `- Open with: Hi ${contactName},`,
    '- Mention VenueDesk is a booking management platform for venue operators',
    '- Remind them of our previous email without being aggressive',
    `- Reference the venue: ${venueName}`,
    '- Close with a soft call to action (e.g., "happy to jump on a 15-minute call")',
    'Return ONLY the email body text, no subject line.',
  ].join('\n');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const completion = await getClient().chat.completions.create({
      model,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    });

    const body    = completion.choices[0]?.message?.content ?? '';
    const subject = `Following up — VenueDesk for ${venueName}`;
    return { subject, body };
  } catch (err) {
    await logger.error('AIService', `generateFollowUp failed for lead ${lead.id}`, { error: err.message });
    return {
      subject: `Following up — VenueDesk for ${venueName}`,
      body:    `Hi ${contactName},\n\nJust following up on our previous email about VenueDesk.\n\nWould you be open to a quick 15-minute call?\n\nBest,\nThe VenueDesk Team`,
    };
  }
}

module.exports = { analyseVenue, generateFollowUp };
