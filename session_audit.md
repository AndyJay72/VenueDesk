# VenueDesk Session Audit — May 2026

**Period covered:** Session starting from migration 016 (tenants RLS policy) through
Ghost Success fix, auth migration, and UI regression repair.
**Auditor role:** Senior Systems Architect / Documentation Lead

---

## Part 1 — Resolved Issues

### 1.1 The "Limbo" State — Enquiry Submissions Without an Anchor ID

**Problem:** `enquiry-form.html` submitted to n8n webhook `d057a40e`, which returned
`{"status":"success"}` — never a `booking_request_id`. `submitWithDeposit()` therefore
always had `bookingRequestId = null`. The Stripe webhook, on completing a payment, had
nothing to link the payment to, leaving the booking in permanent limbo.

**Fix:**
- Created `venuedesk-api/src/routes/enquiry.js` — `POST /enquiry/create-request` (public,
  no JWT). Upserts customer by email+tenant, looks up room by name ILIKE, inserts a
  `booking_requests` row, and returns `{ success: true, booking_request_id, customer_id }`.
- Migration `017_booking_requests_enquiry_fields.sql` added `hire_type`, `total_cost`,
  `event_type`, `notes` columns plus a `UNIQUE(email, tenant_id)` constraint for safe upsert.
- `enquiry-form.html` `SUBMIT_API` changed from n8n to `${EF_DB_API}/enquiry/create-request`.
- `submitWithDeposit()` now reliably captures `ej.booking_request_id`.

**Outcome:** Every enquiry submission anchors a DB row before any Stripe session is created.
The webhook can now resolve the `booking_request_id` on payment completion.

---

### 1.2 Stripe Webhook Signature Verification Failure

**Problem:** The Stripe webhook endpoint was re-serialising `req.body` via
`JSON.stringify(req.body)` as the "raw body" passed to `stripe.webhooks.constructEvent()`.
JSON re-serialisation changes whitespace and key order, breaking the HMAC. Additionally,
webhook secrets stored in environment variables sometimes have trailing newlines (from
Docker/Heroku tooling), causing HMAC mismatch even with the correct secret value.

**Fix (server.js):** Replaced Fastify's built-in JSON parser with a custom
`addContentTypeParser` that stores the raw `Buffer` on `req.rawBody` **before** parsing:
```javascript
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body; // exact bytes Stripe signed
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (err) { err.statusCode = 400; done(err, undefined); }
});
```

**Fix (stripe.js webhook handler):**
```javascript
const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
const secret  = webhookSecret.trim();  // trim trailing newlines
event = stripe.webhooks.constructEvent(rawBody, sig, secret);
```

**Rule added to CLAUDE.md:** Always `.trim()` webhook secrets. Always pass `req.rawBody`
(Buffer) to `constructEvent`, never a re-serialised string.

---

### 1.3 Ghost Success — Dashboard Pay Modal

**Problem:** The n8n `pay-balance` workflow (KHvxUBua7hi5e1x1) fanned out
`Respond: Success` **in parallel** with `DB: Update Balance`. The HTTP 200 reached the
browser before the database write committed. The UI showed a success toast; the booking's
`balance_due` and `status` were never updated.

**Fix:** Created `venuedesk-api/src/routes/payments-manual.js` — `POST /payments/pay`.
A single `withTenantContext` transaction atomically:
1. INSERTs into `bookings.payments`
2. UPDATEs `confirmed_bookings.balance_due` and `status` with a CASE expression
   (`confirmed` when balance reaches 0, `provisional` otherwise)

The HTTP response is only sent after both writes commit. `index.html` `PAY_BALANCE_URL`
changed from n8n to `${DASH_DB_API}/payments/pay`.

---

### 1.4 The Global Scope Bug — `DASH_DB_API` Temporal Dead Zone

**Problem:** A `const` declaration order error silently killed the entire `<script>` block
in `index.html`. The original variable order was:
```javascript
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;  // ← uses DASH_DB_API
// ... 5 lines later ...
const DASH_DB_API = 'https://api.venuedesk.co.uk';       // ← declared too late
```
`const` variables are not hoisted — accessing `DASH_DB_API` before its declaration throws
`ReferenceError: Cannot access 'DASH_DB_API' before initialization`. This error propagated
silently, preventing every downstream function (welcome name, Stripe modal, pay modal,
dashboard load) from executing.

**Symptom:** Dashboard showed "Staff Manager", Stripe modal never appeared, pay button
did nothing — all traced to one line ordering mistake.

**Fix:** Moved `DASH_DB_API` declaration to immediately before `PAY_BALANCE_URL`.

**Rule added to CLAUDE.md:** Declare all API base URL constants (`DASH_DB_API`,
`CAL_DB_API`, `EF_DB_API`) at the **top** of the `<script>` block, before any `const`
that references them in a template literal.

---

### 1.5 Identity Mapping — `name` vs `full_name` in JWT

**Problem (chain of three failures):**
1. `auth.js` was originally a credential-verification-only endpoint — it returned
   `{ success: true, data: rows[0] }` with no JWT. JWT signing was left in n8n, which
   had hollow tokens (missing `tenant_id`, using `name` instead of `full_name`).
2. `index.html` welcome message checked `user.name || user.username` — never `full_name`.
3. The security check at page load did not validate JWT claims, so stale n8n tokens
   (without `tenant_id`) passed silently and caused 401s on every authenticated API call.

**Fixes applied:**
- `auth.js` now signs the JWT with `fastify.jwt.sign()` and returns
  `{ token, user: { id, user_id, username, role, full_name, name, tenant_id } }`.
  Both `id` and `user_id` are set (Pattern 1 normalisation). `name` is an alias for
  `full_name` to support legacy dashboard checks without requiring every page to be patched.
- `login.html` `LOGIN_API` changed from n8n webhook to `https://api.venuedesk.co.uk/auth/login`.
- `index.html` welcome name lookup updated to:
  `user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username`
- Page-load security check now validates `tenant_id` claim — missing or zero triggers
  `sessionStorage.clear()` and redirect to `login.html`.

---

### 1.6 Staff User Tenant Assignment

**Discovery:** Three staff users existed in `bookings.staff_users`:
- `admin` — `tenant_id = 1` (intentional: master/super-admin account)
- `arj72` — `tenant_id = 1001` ✓
- `sun80` — `tenant_id = 0` (broken — no data would ever load)

`sun80` corrected to `tenant_id = 1001`.

**Password reset:** `arj72` could not authenticate because the original n8n login workflow
hashing order or pepper value differed from what `auth.js` expected. Password reset via
direct SHA512+pepper hash injection: `VenueDesk2026!`.

---

### 1.7 User Management — Missing Update Capability

**Problem:** `users.html` had Create and Delete only. No way to update `full_name`, `role`,
or password for an existing staff user.

**Fix:**
- `venuedesk-api/src/routes/users-update.js` — `POST /users/update` (authenticated).
  Accepts `user_id`, `full_name`, `role`, optional `password`. Password hashed with
  SHA512+PEPPER matching `auth.js`. Scoped to JWT `tenant_id` via `withTenantContext`.
- `users.html` — pen icon added per user row; inline edit modal with name, role, and
  optional password reset fields. Saves via `POST /users/update` with JWT body-tunnel.
- `server.js` — `usersUpdateRoutes` registered at `/users` prefix alongside existing
  `usersRoutes` (Fastify additive plugin pattern).

---

## Part 2 — Stripe Configuration Status

| Item | Status |
|------|--------|
| `GET /stripe/config` | ✅ Public endpoint — returns `is_stripe_enabled`, `stripe_publishable_key` |
| `GET /stripe/bacs-details` | ✅ Authenticated — returns BACS fields for pay modal |
| `POST /stripe/session` | ✅ Authenticated (JWT body-tunnel) — creates Checkout session for dashboard |
| `POST /stripe/public-session` | ✅ Public — creates Checkout session for enquiry form (amount bounded £10–£500) |
| `POST /stripe/webhook` | ✅ Signature-verified (raw body + trimmed secret) |
| `admin-config.html` | ✅ Stripe keys saved/loaded via `POST/GET /admin/payment-settings` |
| Dashboard pay modal | ✅ Card method swaps button to "Generate Payment Link" when Stripe enabled |
| Calendar pay step | ✅ Card + Stripe → redirects to Checkout; non-Stripe records deposit immediately |
| Enquiry form | ✅ Deposit button creates Stripe session via `/public-session` |
| `checkout.html` | ✅ Handles `session_id` return URL; confirms payment to user |

---

## Part 3 — Outstanding Issues

### 3.1 Final Smoke Test — Card Payment Redirect

The `DASH_DB_API` temporal dead zone fix was committed but the user had not confirmed a
successful end-to-end card payment test at the time of this audit. The following test
path is outstanding:

1. Log in as `arj72` (incognito window, fresh sessionStorage)
2. Open a confirmed booking with balance due
3. Record Payment → Card → Generate Payment Link
4. Complete Stripe test payment (`4242 4242 4242 4242`)
5. Verify `checkout.html` loads with session confirmation
6. Verify `confirmed_bookings.balance_due` updated and `status` correct in DB

### 3.2 Users.html — Edit Modal GitHub Pages Cache

The edit modal was committed in `10298c2` and is present in the source. The user reported
not seeing the pen icon, consistent with GitHub Pages CDN serving a cached version.
**Action:** Test in a new incognito window after a 2–5 minute propagation delay.

### 3.3 Multi-Date Array Feature (Deferred)

The recurring-bookings page multi-date array feature (drag-select day ranges, specific
date mode) was discussed but not implemented in this session. Deferred to next session.

### 3.4 `admin` Super-Admin Tenant Isolation

The `admin` user (`tenant_id = 1`) will receive `tenant_id: 1` in its JWT. Any page that
uses this token to query `bookings.*` tables will return empty results because all data
is under `tenant_id = 1001`. The super-admin account is operational for system management
only — not for day-to-day venue operations.

---

## Part 4 — Commits This Session

| Commit | Summary |
|--------|---------|
| `2713cff` | Migration 016 — RLS policy for `bookings.tenants` (fixes empty `/stripe/config`) |
| `64643fd` | Enquiry endpoint, hire type, cost calc, Stripe interceptor fix |
| `39458a0` | Ghost Success fix, webhook raw body, status CASE, `payments-manual.js` |
| `aca5eb3` | Auth migration — `auth.js` signs JWT, `login.html` points to db-api |
| `f5740b5` | `name` alias in JWT payload for legacy dashboard checks |
| `10298c2` | User edit modal, `users-update.js`, `server.js` registration |
| `(pending)` | `DASH_DB_API` declaration order fix, token claim validation, `full_name` priority |
