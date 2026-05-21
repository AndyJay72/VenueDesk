'use strict';

/**
 * errors.js — typed HTTP error factory.
 *
 * Eliminates the raw `err.statusCode = 404; throw err;` pattern that
 * currently appears in routes/leads.js and services/LeadPromotion.js.
 *
 * The global error handler (middleware/errorHandler.js) reads `.statusCode`
 * from thrown errors to set the HTTP response code, so all errors created
 * here are automatically handled correctly with no extra boilerplate.
 *
 * Usage:
 *   const { HttpError, notFound, conflict } = require('../utils/errors');
 *
 *   // Throw directly:
 *   throw new HttpError(409, 'Booking already exists for this slot');
 *
 *   // Or use named factories:
 *   throw notFound('Lead', leadId);
 *   throw conflict('outstanding_payments', 'recurring_rule_id + period_start');
 *   throw forbidden('Admin role required');
 */

class HttpError extends Error {
  /**
   * @param {number} statusCode  HTTP status code (400, 401, 403, 404, 409, 422, 500…)
   * @param {string} message     Human-readable error message
   * @param {string} [code]      Optional machine-readable error code for the response envelope
   */
  constructor(statusCode, message, code) {
    super(message);
    this.name       = 'HttpError';
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

// ── Named factories — cover the four most common cases in this codebase ──────

/**
 * 404 — resource not found.
 *
 * @param {string} entity    e.g. 'Lead', 'Customer', 'Booking'
 * @param {string} [id]      The ID that was looked up, included in the message
 * @returns {HttpError}
 *
 * @example
 *   throw notFound('Lead', leadId);
 *   // → HttpError: Lead not found: f47ac10b-...
 */
function notFound(entity, id) {
  const msg = id ? `${entity} not found: ${id}` : `${entity} not found`;
  return new HttpError(404, msg, 'NOT_FOUND');
}

/**
 * 409 — unique constraint or business rule conflict.
 *
 * @param {string} entity    e.g. 'outstanding_payments'
 * @param {string} [detail]  e.g. 'recurring_rule_id + period_start'
 * @returns {HttpError}
 *
 * @example
 *   throw conflict('Booking', 'this time slot is already taken');
 */
function conflict(entity, detail) {
  const msg = detail ? `${entity} conflict: ${detail}` : `${entity} already exists`;
  return new HttpError(409, msg, 'CONFLICT');
}

/**
 * 403 — authenticated but not authorised.
 *
 * @param {string} [reason]
 * @returns {HttpError}
 */
function forbidden(reason = 'You do not have permission to perform this action') {
  return new HttpError(403, reason, 'FORBIDDEN');
}

/**
 * 400 — bad request / validation failure.
 *
 * @param {string} message
 * @returns {HttpError}
 */
function badRequest(message) {
  return new HttpError(400, message, 'VALIDATION_ERROR');
}

/**
 * 422 — request is well-formed but semantically invalid.
 * Use when input passes type validation but fails business rules
 * (e.g. booking end_time before start_time).
 *
 * @param {string} message
 * @returns {HttpError}
 */
function unprocessable(message) {
  return new HttpError(422, message, 'UNPROCESSABLE');
}

module.exports = { HttpError, notFound, conflict, forbidden, badRequest, unprocessable };
