'use strict';

/**
 * validators.js — input validation helpers.
 *
 * CLAUDE.md §2.5 mandates that every API endpoint validates:
 *   - UUID format
 *   - Required fields
 *   - Data types
 *
 * Centralising this here means validators are testable in isolation and
 * never duplicated across route handlers and service functions.
 *
 * All validators throw a typed HttpError (from errors.js) on failure so
 * the global error handler can return a consistent 400 response without
 * any extra boilerplate at the call site.
 */

const { HttpError } = require('./errors');

// RFC 4122 UUID v4 pattern — also accepts other versions produced by PostgreSQL gen_random_uuid()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed lead status values — single source of truth
const LEAD_STATUSES = new Set([
  'new', 'scored', 'contacted', 'follow_up',
  'hot_prospect', 'onboarded', 'disqualified',
]);

// Allowed billing schedule statuses
const BILLING_STATUSES = new Set(['pending', 'paid', 'cancelled', 'overdue']);

/**
 * Assert that `value` is a valid UUID string.
 * Throws HttpError(400) if not.
 *
 * @param {*}      value
 * @param {string} [fieldName='id']
 *
 * @example
 *   assertUUID(req.params.id, 'lead_id');
 */
function assertUUID(value, fieldName = 'id') {
  if (!value || typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    throw new HttpError(400, `${fieldName} must be a valid UUID — received: ${JSON.stringify(value)}`);
  }
}

/**
 * Assert that all keys in `requiredKeys` are present and non-empty in `obj`.
 * Throws HttpError(400) listing all missing fields at once.
 *
 * @param {object}   obj
 * @param {string[]} requiredKeys
 *
 * @example
 *   assertRequired(req.body, ['customer_id', 'status']);
 */
function assertRequired(obj, requiredKeys) {
  const missing = requiredKeys.filter(
    (k) => obj[k] === undefined || obj[k] === null || obj[k] === ''
  );
  if (missing.length) {
    throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
  }
}

/**
 * Assert that `value` is a string (optionally within a max length).
 * Throws HttpError(400) if not.
 *
 * @param {*}      value
 * @param {string} fieldName
 * @param {number} [maxLen]
 */
function assertString(value, fieldName, maxLen) {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${fieldName} must be a string`);
  }
  if (maxLen !== undefined && value.length > maxLen) {
    throw new HttpError(400, `${fieldName} must be at most ${maxLen} characters`);
  }
}

/**
 * Assert that `value` is a finite number (or a numeric string).
 * Returns the coerced number.
 *
 * @param {*}      value
 * @param {string} fieldName
 * @returns {number}
 */
function assertNumber(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpError(400, `${fieldName} must be a finite number — received: ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * Assert that `value` is one of the valid lead statuses.
 * Throws HttpError(400) if not.
 *
 * @param {*}      value
 * @param {string} [fieldName='status']
 */
function assertLeadStatus(value, fieldName = 'status') {
  if (!LEAD_STATUSES.has(value)) {
    throw new HttpError(
      400,
      `${fieldName} must be one of: ${[...LEAD_STATUSES].join(', ')} — received: ${JSON.stringify(value)}`
    );
  }
}

/**
 * Assert that `value` is a plausible email address.
 * This is a fast structural check, not RFC 5321 full validation.
 * Throws HttpError(400) if the format is clearly wrong.
 *
 * @param {*}      value
 * @param {string} [fieldName='email']
 */
function assertEmail(value, fieldName = 'email') {
  if (!value || typeof value !== 'string') {
    throw new HttpError(400, `${fieldName} is required and must be a string`);
  }
  const parts = value.trim().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1].includes('.')) {
    throw new HttpError(400, `${fieldName} is not a valid email address: ${JSON.stringify(value)}`);
  }
}

/**
 * Returns `true` if `value` is a valid UUID string. Non-throwing alternative
 * to `assertUUID` — useful for conditional logic rather than guard clauses.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isUUID(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

module.exports = {
  assertUUID,
  assertRequired,
  assertString,
  assertNumber,
  assertLeadStatus,
  assertEmail,
  isUUID,
  LEAD_STATUSES,
  BILLING_STATUSES,
};
