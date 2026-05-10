'use strict';

const nodemailer = require('nodemailer');
const logger     = require('./LoggerService');
const { formatGBP, formatDateGB, ucFirst } = require('../utils/format');

/**
 * EmailService — thin Nodemailer wrapper.
 *
 * Replaces all n8n emailSend nodes. The transporter is created once
 * at module load; individual sends are fire-and-forget from the caller's
 * perspective (they await, but failures are caught and logged, not thrown).
 *
 * All methods return { success: boolean, messageId?: string, error?: string }
 * so callers can decide whether to surface failures.
 */

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send an HTML email.
 *
 * @param {{ to: string, subject: string, html: string, replyTo?: string }} opts
 * @param {number} [tenantId]
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendHtml({ to, subject, html, replyTo }, tenantId = null) {
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'VenueDesk'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    await logger.info('EmailService', `Email sent to ${to}`, { subject, messageId: info.messageId }, tenantId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    await logger.error('EmailService', `Failed to send email to ${to}`, { subject, error: err.message }, tenantId);
    return { success: false, error: err.message };
  }
}

/**
 * Build the billing reminder HTML body.
 * Ported 1:1 from BillingCycleTrigger → Code: Format Email.
 */
function buildBillingReminderHtml({ customerName, frequency, cycleNum, totalCycles, seriesReference, roomName, amountDue, dueDate, remainingCycles }) {
  const dueFormatted = formatDateGB(dueDate);
  const freq         = ucFirst(frequency || 'recurring');
  const cycleStr     = (cycleNum && totalCycles) ? ` (Cycle ${cycleNum} of ${totalCycles})` : '';
  const seriesStr    = seriesReference ? ` · ${seriesReference}` : '';
  const subject      = `Recurring booking payment due${seriesStr} — £${formatGBP(amountDue)}`;

  const html = `
    <p>Dear ${customerName || 'Valued Customer'},</p>
    <p>This is a friendly reminder that your ${freq} booking payment is due${cycleStr}:</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      ${seriesReference ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Series ref:</td><td><strong>${seriesReference}</strong></td></tr>` : ''}
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Room:</td><td><strong>${roomName || '—'}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Amount due:</td><td><strong>£${formatGBP(amountDue)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Due by:</td><td>${dueFormatted}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Remaining payments:</td><td>${remainingCycles || '—'}</td></tr>
    </table>
    <p>Please contact us to arrange payment before the due date to keep your recurring booking active.</p>
    <p>Thank you,<br>The VenueDesk Team</p>
  `;

  return { subject, html };
}

module.exports = { sendHtml, buildBillingReminderHtml };
