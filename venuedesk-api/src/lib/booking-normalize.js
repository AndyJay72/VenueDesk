'use strict';

/**
 * booking-normalize.js — Defensive financial-field computation for
 * booking_requests + confirmed_bookings.
 *
 * Pure functions only. No DB, no network. Every helper:
 *   - Returns a number (never null / undefined / NaN). Falls back to a safe
 *     default the schema's NOT NULL constraints can accept.
 *   - Is coalesce-only: never overwrites a meaningful caller-supplied value.
 *     Pass the existing value as the first arg; the helper only kicks in if
 *     it's null / undefined / NaN / negative.
 *
 * Why this module exists:
 *   Public enquiry deposits cleared Stripe but never appeared on calendar.html
 *   / accounts.html / audit-log.html. Root cause: booking_requests rows landed
 *   with null total_hours / estimated_cost / deposit_amount, and downstream
 *   math nodes (n8n + db-api dashboards) crashed silently on the nulls.
 *
 *   The fix is to compute these at ingestion time and persist them — so a
 *   booking_request row is fully self-describing the moment it's written.
 */

const DEFAULT_HOURS         = 1.0;
const DEFAULT_DEPOSIT_TIER  = 10.00;   // matches /stripe/public-session minimum

// ──────────────────────────────────────────────────────────────────────────────
// Internal: safe-parse a value to a float. Returns null when the value is
// genuinely unparsable; returns 0 when the value is the literal 0 (so the
// caller can distinguish "missing" from "intentionally zero").
function _toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return null;
    return n;
}

// ──────────────────────────────────────────────────────────────────────────────
// calcHoursBetween('10:00', '12:30') → 2.5
// Accepts 'HH:MM' or 'HH:MM:SS'. Returns DEFAULT_HOURS (1.0) on any parse
// failure or non-positive duration.
function calcHoursBetween(startTime, endTime) {
    try {
        if (!startTime || !endTime) return DEFAULT_HOURS;
        const [sh, sm] = String(startTime).split(':').map(n => parseInt(n, 10));
        const [eh, em] = String(endTime).split(':').map(n => parseInt(n, 10));
        if (![sh, sm, eh, em].every(Number.isFinite)) return DEFAULT_HOURS;
        const hours = ((eh + em / 60) - (sh + sm / 60));
        if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_HOURS;
        // Round to 0.01h to keep DB numeric(5,2) clean
        return Math.round(hours * 100) / 100;
    } catch (_e) {
        return DEFAULT_HOURS;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveHours(existing, startTime, endTime)
// Coalesce-only: returns existing if it's a positive finite number; otherwise
// computes from the times. Never returns null.
function resolveHours(existing, startTime, endTime) {
    const n = _toNum(existing);
    if (n !== null && n > 0) return n;
    return calcHoursBetween(startTime, endTime);
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveEstimatedCost(existing, hours, ratePerHour, fallbackTotal)
// Priority: caller's existing > hours × rate > fallbackTotal > 0
function resolveEstimatedCost(existing, hours, ratePerHour, fallbackTotal) {
    const n = _toNum(existing);
    if (n !== null && n > 0) return Math.round(n * 100) / 100;
    const h = _toNum(hours);
    const r = _toNum(ratePerHour);
    if (h !== null && h > 0 && r !== null && r > 0) {
        return Math.round(h * r * 100) / 100;
    }
    const fb = _toNum(fallbackTotal);
    if (fb !== null && fb > 0) return Math.round(fb * 100) / 100;
    return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveDepositAmount(existing, depositIntent, stripeSession, defaultTier)
// Priority for deposit-backed rows:
//   1. caller's existing (staff-set or already-persisted value)
//   2. stripeSession.amount_total / 100  (single source of truth post-payment)
//   3. defaultTier (DEFAULT_DEPOSIT_TIER, £10.00)
// For non-deposit-intent rows: returns null (no deposit was expected).
function resolveDepositAmount(existing, depositIntent, stripeSession, defaultTier) {
    const intent = depositIntent === true || depositIntent === 'true' || depositIntent === 1;
    if (!intent) {
        // Free-enquiry path — preserve null when existing is null
        const n = _toNum(existing);
        return n !== null && n > 0 ? Math.round(n * 100) / 100 : null;
    }
    const n = _toNum(existing);
    if (n !== null && n > 0) return Math.round(n * 100) / 100;
    // Try Stripe session.amount_total (in pence)
    const stripeAmt = _toNum(stripeSession && stripeSession.amount_total);
    if (stripeAmt !== null && stripeAmt > 0) return Math.round((stripeAmt / 100) * 100) / 100;
    const tier = _toNum(defaultTier);
    return tier !== null && tier > 0 ? tier : DEFAULT_DEPOSIT_TIER;
}

// ──────────────────────────────────────────────────────────────────────────────
// normaliseBookingRequest(input, opts)
// One-call wrapper that produces the full computed shape. Use this immediately
// before INSERT-ing into booking_requests. Wrap the call in try/catch at the
// caller — this module never throws but the caller's logging discipline matters.
//
// input:  { start_time, end_time, total_hours, estimated_cost, total_cost,
//           deposit_amount, deposit_intent, ... }
// opts:   { ratePerHour, stripeSession, defaultDeposit }
// Returns { total_hours, estimated_cost, deposit_amount } — all numbers.
function normaliseBookingRequest(input, opts) {
    input = input || {};
    opts  = opts  || {};
    const hours = resolveHours(input.total_hours, input.start_time, input.end_time);
    const cost  = resolveEstimatedCost(
        input.estimated_cost,
        hours,
        opts.ratePerHour,
        input.total_cost ?? input.total_amount
    );
    const dep   = resolveDepositAmount(
        input.deposit_amount,
        input.deposit_intent,
        opts.stripeSession,
        opts.defaultDeposit ?? DEFAULT_DEPOSIT_TIER
    );
    return { total_hours: hours, estimated_cost: cost, deposit_amount: dep };
}

// ──────────────────────────────────────────────────────────────────────────────
// Dual-ingestion primitives — calendar.html (legacy/admin) vs enquiry-form.html
// (public) send different field names for the same data. These helpers absorb
// the variance so the route handler doesn't have to think about source.
// ──────────────────────────────────────────────────────────────────────────────

// resolveCustomerName(...candidates)
// Returns the first truthy non-blank string from the candidates, trimmed,
// capped at 200 chars (matches customers.full_name CHECK). Falls back to
// 'Valued Customer' so the DB INSERT never fails on a NOT NULL constraint.
// Canonical use: resolveCustomerName(body.full_name, body.name, body.customer_name)
function resolveCustomerName(/* ...candidates */) {
    for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (typeof v === 'string') {
            const t = v.trim();
            if (t) return t.substring(0, 200);
        }
    }
    return 'Valued Customer';
}

// coerceNumeric(value, opts)
// Robust string|number|null → number coercion sized for NUMERIC(p, scale).
// opts.fallback — value when coercion fails (default 0).
// opts.min      — clamp lower bound (default -Infinity).
// opts.max      — clamp upper bound (default Infinity).
// opts.scale    — round to N decimal places (default 2, matches NUMERIC(_,2)).
// Strips common currency prefixes ('£', '$', ',') so '£1,234.50' → 1234.50.
function coerceNumeric(value, opts) {
    opts = opts || {};
    const fallback = (opts.fallback !== undefined) ? opts.fallback : 0;
    const min      = (opts.min      !== undefined) ? opts.min      : -Infinity;
    const max      = (opts.max      !== undefined) ? opts.max      :  Infinity;
    const scale    = (opts.scale    !== undefined) ? opts.scale    : 2;
    if (value === null || value === undefined) return fallback;
    let n;
    if (typeof value === 'number') {
        n = value;
    } else if (typeof value === 'string') {
        const cleaned = value.replace(/[£$,\s]/g, '').trim();
        if (!cleaned) return fallback;
        n = parseFloat(cleaned);
    } else if (typeof value === 'boolean') {
        n = value ? 1 : 0;
    } else {
        return fallback;
    }
    if (!Number.isFinite(n)) return fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    const factor = Math.pow(10, scale);
    return Math.round(n * factor) / factor;
}

module.exports = {
    DEFAULT_HOURS,
    DEFAULT_DEPOSIT_TIER,
    calcHoursBetween,
    resolveHours,
    resolveEstimatedCost,
    resolveDepositAmount,
    normaliseBookingRequest,
    // Dual-ingestion primitives
    resolveCustomerName,
    coerceNumeric,
};
