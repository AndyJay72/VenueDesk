'use strict';

/**
 * format.js — shared formatting helpers.
 *
 * Eliminates inline repetition of:
 *   parseFloat(x).toFixed(2)           → formatGBP()      (4 occurrences)
 *   ((Date.now() - t0) / 1000).toFixed(1) + 's'  → elapsedSec()  (4 occurrences)
 *   str.substring(0, N)                → truncate()       (3 occurrences)
 *   new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {...})  → formatDateGB()
 */

/**
 * Format a numeric value as a GBP string with exactly 2 decimal places.
 * Handles strings, numbers, null, and undefined safely.
 *
 * @param {number|string|null|undefined} amount
 * @returns {string}  e.g. "125.00"
 *
 * @example
 *   formatGBP(125)        // "125.00"
 *   formatGBP('99.9')     // "99.90"
 *   formatGBP(null)       // "0.00"
 */
function formatGBP(amount) {
  const n = parseFloat(amount);
  return (isNaN(n) ? 0 : n).toFixed(2);
}

/**
 * Return the elapsed seconds since `startMs` as a "X.Xs" string.
 * Used in every service's run-complete log line.
 *
 * @param {number} startMs  Result of Date.now() captured before the operation
 * @returns {string}  e.g. "3.7s"
 *
 * @example
 *   const t0 = Date.now();
 *   await doWork();
 *   log.info('done', elapsedSec(t0));  // "done 2.1s"
 */
function elapsedSec(startMs) {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

/**
 * Truncate a string to a maximum byte-safe character length.
 * Returns the original value unchanged if it is already within the limit.
 * Safe against null/undefined.
 *
 * @param {string|null|undefined} str
 * @param {number} maxLen  Maximum number of characters to keep
 * @returns {string}
 *
 * @example
 *   truncate('Hello World', 5)  // "Hello"
 *   truncate(null, 100)         // ""
 */
function truncate(str, maxLen) {
  const s = String(str ?? '');
  return s.length <= maxLen ? s : s.substring(0, maxLen);
}

/**
 * Format an ISO date string (YYYY-MM-DD) as a human-readable British date.
 * Uses UTC midnight to avoid timezone-shift-by-one-day bugs.
 *
 * @param {string|null|undefined} isoDate  e.g. "2026-05-01"
 * @param {string} [fallback='—']         Returned when isoDate is falsy
 * @returns {string}  e.g. "1 May 2026"
 *
 * @example
 *   formatDateGB('2026-05-01')   // "1 May 2026"
 *   formatDateGB(null)           // "—"
 */
function formatDateGB(isoDate, fallback = '—') {
  if (!isoDate) return fallback;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-GB', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Capitalise the first character of a string.
 *
 * @param {string|null|undefined} str
 * @returns {string}  e.g. "fortnightly" → "Fortnightly"
 */
function ucFirst(str) {
  const s = String(str ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { formatGBP, elapsedSec, truncate, formatDateGB, ucFirst };
