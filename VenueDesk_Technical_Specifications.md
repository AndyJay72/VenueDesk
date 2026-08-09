# VenueDesk — Technical Specifications

**Version:** 3.0
**Date:** July 2026
**Status:** Active Development — Phases 1–3 Complete, Phase 4 (RLS) Substantially Complete

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Frontend](#3-frontend)
4. [Backend — db-api (Fastify)](#4-backend--db-api-fastify)
5. [Backend — n8n Workflows](#5-backend--n8n-workflows)
6. [Database Schema](#6-database-schema)
7. [API Endpoints](#7-api-endpoints)
8. [Authentication & Security](#8-authentication--security)
9. [Stripe Integration](#9-stripe-integration)
10. [Booking Logic & Data Flows](#10-booking-logic--data-flows)
11. [Multi-Tenancy](#11-multi-tenancy)
12. [Configuration & Environment](#12-configuration--environment)
13. [Migration Roadmap](#13-migration-roadmap)
14. [Development Rules & Guardrails](#14-development-rules--guardrails)

---

## Changelog

### v3.0 — July 2026

Major update covering all work completed between May–June 2026. New and changed items:

- **Hierarchical space partitioning** (parent/child/sibling rooms, fraction-aware clash detection via recursive CTE, migrations 028)
- **Public enquiry form** (`enquiry-form.html`) — real-time availability, multi-day booking, additional rooms, Stripe deposit, fire-and-forget email notification
- **Stripe return page** (`checkout.html`) — static landing page with staff/public CTA branch
- **Tenant Lifecycle & CRM Dashboard** (`onboarding.html`) — super-admin portal, telemetry, seat stepper, system audit modal
- **Interactive super-admin guide** (`onboarding-guide.html`)
- **Automated email notifications** at every booking lifecycle stage (5 triggers, new `NewEnquiryNotification.json` workflow)
- **Per-venue staff notification email** configurable via Admin Config Settings tab; read from `GET /stripe/config`
- **Room hours enforcement** — `open_time`/`close_time` on `bookings.rooms` (migrations 024–025); enforced in `/bookings/create` and surfaced in `calendar.html` quick-book panel
- **Policy templates** — `bookings.policy_templates` table (migration 023); `GET/POST /config/policy-templates`
- **Admin audit log + health** — `bookings.admin_audit_log`, `bookings.system_health` tables (migration 026); `/health/ping`, `/health/pulse`, `/admin/audit-log`, `/admin/system-logs`
- **Contact name on tenants** — `bookings.tenants.contact_name` (migration 027); `GET /onboarding/venues` reads `COALESCE(t.contact_name, u.full_name)`
- **Race condition fix** — partial unique index on `confirmed_bookings` (migration 022); `/bookings/create` catches `23505` → 409
- **UTC date guards** — `Date.UTC()` anchored past-date guard and 90-day ceiling in `/bookings/create` (BST/DST safe)
- **N8N_SERVICE_JWT multi-tenant isolation bug fixed** — all user-facing n8n HTTP Request nodes now forward the user's own JWT; 10 workflows corrected; Phase 2 violations: 0
- **Full localStorage → sessionStorage audit** complete (June 2026); all auth/identity keys migrated
- **Rule F4 JWT claim validation** added to all 8 authenticated pages
- **Per-cycle payment schema** (migrations 020–021) — `recurring_series.cycle_length_weeks`, `recurring_payment_schedule` Stripe retry tracking, `payments.payment_type` extended to include `cycle`
- **Booking request computed fields** (migrations 018–019) — `deposit_intent`, `additional_rooms` JSONB, `total_hours`, `estimated_cost`, `deposit_amount`
- **Root vs CommunityHub two-copy rule** clarified — GitHub Pages serves from repo root, not `CommunityHub/`
- **Frontend file tree updated** to reflect current live page set

### v2.0 — May 2026

Initial structured specification. Captured post-Phase 3 (JWT complete) architecture, db-api route map, n8n workflow index, database schema, Stripe integration, and booking logic. Phase 4 (RLS) flagged as in progress.

---

## 1. System Overview

VenueDesk is a multi-tenant venue booking and CRM platform for community halls, sports centres, and event spaces. It manages:

- Single and recurring room bookings
- Customer records and interaction history
- Recurring contract management with parent-child session architecture
- Automated payment chasing and billing cycles
- Staff user management and audit logging
- Lead generation and enquiry capture
- Stripe-powered online payments (card + BACS)
- **Hierarchical space partitioning** (parent/child/sibling rooms with fraction-aware clash detection)
- **Online enquiry form** with real-time availability, multi-day booking, additional rooms, and Stripe deposit
- **Super-admin onboarding portal** with tenant lifecycle CRM and telemetry dashboard
- **Automated email notifications** at every booking lifecycle stage (enquiry, confirmation, payment, expiry warning)
- **Per-venue configurable staff notification email**

As of July 2026, the platform has completed the migration from a direct-database n8n architecture to a secure db-api layer. JWT authentication is issued and verified exclusively by `venuedesk-api` (Fastify). PostgreSQL Row-Level Security is enabled and forced on all 12 tenant-scoped tables. n8n is retained for recurring booking orchestration, scheduled automation, and email workflows — it no longer executes raw SQL for any core path.

**Phase 4 (RLS) is substantially complete.** All user-facing data paths go through db-api with JWT auth and RLS enforcement. Phase 2 violations: 0 (resolved June 2026, verified via full audit).

---

## 2. Architecture

### 2.1 Current Architecture (Post Phase 1–4 Migration)

```
Client (Browser — GitHub Pages)
         │ HTTP / JSON
         │ JWT via body tunnel (POST) or query param (GET)
         ▼
  venuedesk-api  ──────────────────────────────────────────
  (Node.js / Fastify — https://api.venuedesk.co.uk)       │
  Auth + Validation + Tenant Context + Audit Logging       │
         │ set_config('app.tenant_id', <from JWT>, true)   │
         ▼                                                  │
    PostgreSQL                                              │
    (bookings schema — RLS enforced + forced on all        │
     12 tenant-scoped tables)                              │
                                                            │
  n8n Webhooks  ◄─────────────────────────────────────────
  (Orchestration only — recurring bookings, email, automation)
  https://n8n.srv1090894.hstgr.cloud/webhook
         │
         ▼
    PostgreSQL (via db-api HTTP calls — no direct SQL in n8n)
```

**Key routing split:**

| Route category | Handler |
|---|---|
| Auth (`/auth/login`) | db-api |
| Dashboard data | db-api |
| Bookings CRUD | db-api |
| Payments (manual + Stripe) | db-api |
| Enquiry form submission | db-api |
| Staff user management | db-api |
| Customers | db-api |
| Config / rooms / event types / pricing | db-api |
| Blocked dates | db-api |
| Add-on services | db-api |
| Policy templates | db-api |
| Onboarding / tenant lifecycle | db-api |
| Health + telemetry | db-api |
| Admin audit log | db-api |
| Recurring series creation | n8n (orchestration — calls db-api internally) |
| Payment chasing automation | n8n (scheduled) |
| Email notifications | n8n (triggered by enquiry/booking/payment events) |

### 2.2 Infrastructure

| Service | URL / Location |
|---|---|
| **db-api** (Fastify) | `https://api.venuedesk.co.uk` |
| **n8n** (workflow editor) | `https://n8n.srv1090894.hstgr.cloud` |
| **Frontend** (GitHub Pages) | `https://andyjay72.github.io/VenueDesk` |
| **GitHub repository** | `https://github.com/AndyJay72/VenueDesk` |
| **VPS IP** | `72.61.19.52` |
| **db-api container** | `venuedesk-api` (Docker) |
| **Postgres container** | `n8n_postgres-postgres-1` (Docker) |
| **Host source path** | `/opt/n8n_postgres/venuedesk-api/` |

### 2.3 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, FullCalendar 6, HTML5/CSS3 |
| API layer | Node.js 20 / Fastify 4, `@fastify/jwt`, `@fastify/cors` |
| Orchestration | n8n (self-hosted, webhook-driven — orchestration only) |
| Database | PostgreSQL 15 (`bookings` schema) |
| Auth | JWT HS256, signed by `venuedesk-api` |
| Payments | Stripe Checkout (card) + BACS |
| Hosting — frontend | GitHub Pages (static, served from repo root) |
| Hosting — API + DB | VPS (Docker Compose — Traefik proxy) |
| Fonts / Icons | Plus Jakarta Sans (Google Fonts), Font Awesome 6 |

---

## 3. Frontend

### 3.1 Architecture — Static HTML (Not SPA)

The frontend is **static HTML/CSS/JS** served via GitHub Pages from the **repository root**. There is no build step, no bundler, no SPA framework. All pages are standalone `.html` files. Each page manages its own state and API calls via embedded `<script>` blocks and vanilla JavaScript.

**Do not introduce Vite, Webpack, React, Vue, or any build tooling.** All fixes and features must be vanilla JS edits to existing `.html` files.

**Two-copy rule:** Every HTML page exists in two locations — the repo root (live, served by GitHub Pages) and `CommunityHub/` (backup mirror, not deployed). Every change must update both copies.

```
/                                   ← LIVE — served by GitHub Pages
├── index.html                      Main dashboard (KPIs, bookings, payments)
├── login.html                      Auth page → POST /auth/login on db-api
├── calendar.html                   FullCalendar day/week/month view
├── accounts.html                   Financial overview
├── customers.html                  Customer CRM (list, search, interactions)
├── users.html                      Staff user management (list, create, edit, delete)
├── admin-config.html               Venue settings — 8 tabs (see §3.12)
├── enquiry-form.html               Public enquiry capture (see §3.9)
├── checkout.html                   Stripe payment return URL handler (see §3.10)
├── onboarding.html                 Tenant Lifecycle & CRM Dashboard — super-admin (see §3.11)
├── onboarding-guide.html           Interactive super-admin user guide
├── audit-log.html                  Staff activity and customer interaction audit log
├── final-payment.html              Staff balance collection page
├── recurring-bookings.html         Recurring contract creation (1,200+ lines)
├── manual-booking.html             Single booking form
└── CommunityHub/                   ← MIRROR — not served, backup only
    └── <all of the above>.html
```

### 3.2 Global JavaScript Contract

Every page script must open with API base URL constants **before** any `const` that references them in a template literal. This is a hard rule — a `const` referencing an undeclared `const` in a template literal throws a silent `ReferenceError` that kills the entire `<script>` block.

```javascript
// ── API base URLs — MUST be declared first ───────────────────────────────────
const DASH_DB_API = 'https://api.venuedesk.co.uk';
const CAL_DB_API  = 'https://api.venuedesk.co.uk';
const EF_DB_API   = 'https://api.venuedesk.co.uk';

// ── Derived URLs — safe after base URLs are declared ─────────────────────────
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
const LOG_PAYMENT_URL = `${DASH_DB_API}/audit/log`;
```

### 3.3 Session Storage Keys

All pages read from `sessionStorage` (not `localStorage`) for auth and identity keys. Login must set all keys on successful authentication. UI preference keys remain in `localStorage` — this is intentional.

| Key | Storage | Value | Used for |
|---|---|---|---|
| `vp_token` | sessionStorage | JWT string | Body-tunnel in all POST requests, query param in GET |
| `vp_tenant_id` | sessionStorage | Numeric string (e.g., `"1001"`) | Tenant isolation on all queries |
| `vp_user_name` | sessionStorage | User display name | `staff_member` field on interactions |
| `vp_venue_name` | sessionStorage | Venue display name | Sidebar display |
| `vp_user` | sessionStorage | `JSON.stringify(user)` | Full user context object |
| `vd_admin_auth` | sessionStorage | `"1"` | Onboarding portal admin key gate — expires on browser close |
| `vp_sidebar_col` | localStorage | Color preference | Sidebar colour (UI preference — intentional persistence) |
| `vp_theme` | localStorage | Theme string | App theme (UI preference — intentional persistence) |
| `vp_light_mode` | localStorage | `"1"` | Light mode toggle (UI preference — intentional persistence) |
| `vp_sidebar_collapsed` | localStorage | `"1"` | Sidebar collapse state (UI preference — intentional persistence) |

**Audit status (June 2026):** All live root files confirmed clean — every auth/identity key uses sessionStorage. `CommunityHub/preview/` and `CommunityHub/spa/` are archive files, not live, and not required to be fixed.

### 3.4 Auth Pattern (CORS Constraint — Body Tunnel)

The db-api CORS config allows only `Content-Type` in `allowedHeaders`. Sending an `Authorization: Bearer` header triggers a CORS preflight that the browser blocks. **Never add `Authorization` to frontend `fetch` calls.**

JWT travels via the request body for POST calls and the query string for GET calls:

```javascript
// Helper functions used across all pages
function _TID() { return sessionStorage.getItem('vp_tenant_id') || '0'; }
function tidParam(sep = '?') { return sep + 'tenant_id=' + _TID(); }

// GET with tenant isolation
fetch(`${DB_API}/some/endpoint${tidParam()}`)

// GET with auth (authenticated GET endpoints)
const tok = sessionStorage.getItem('vp_token') || '';
fetch(`${DB_API}/stripe/bacs-details?jwt=${encodeURIComponent(tok)}`)

// POST with JWT body-tunnel
fetch(SOME_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jwt:       sessionStorage.getItem('vp_token') || '',
    tenant_id: parseInt(_TID()),
    // ... request fields
  })
});
```

**Scope — browser only.** This rule applies to browser → db-api calls where CORS preflight is in play. n8n HTTP Request nodes calling db-api, curl/Postman smoke tests, and scheduled tasks are server-to-server and **must** use the standard `Authorization: Bearer <jwt>` header — there is no browser and no preflight. Do not strip `Authorization` headers from n8n nodes in a "consistency pass" — that breaks n8n → db-api calls because the body-tunnel fallback is not reliable for `$json`-constructed payloads.

### 3.5 Page-Load JWT Validation

Every authenticated page must validate JWT claims at load time. Add as the **first** `<script>` block:

```javascript
(function () {
  const _t = sessionStorage.getItem('vp_token');
  if (!_t) { window.location.href = 'login.html'; return; }
  try {
    const _p = JSON.parse(atob(_t.split('.')[1]));
    if (_p.exp && _p.exp * 1000 < Date.now()) {
      sessionStorage.clear(); window.location.href = 'login.html'; return;
    }
    const uid = _p.user_id || _p.id;
    if (!uid || !_p.tenant_id) {
      console.warn('[auth] stale token — missing claims', _p);
      sessionStorage.clear(); window.location.href = 'login.html';
    }
  } catch (e) { /* non-JWT, skip */ }
})();
```

**Deployment status (June 2026):** All 8 authenticated pages have this check. Pages confirmed: `index.html`, `calendar.html`, `customers.html`, `accounts.html`, `users.html`, `admin-config.html`, `final-payment.html`, `manual-booking.html`, `recurring-bookings.html`, `audit-log.html`.

### 3.6 Identity Resolution

Always resolve display names in this priority order:

```javascript
const name = user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff Manager';
```

`auth.js` must include both `full_name` and `name` (alias) in every JWT payload and login response so all pages work regardless of which field they check.

### 3.7 Recurring Bookings Interface (`recurring-bookings.html`)

A standalone 1,200+ line page with its own embedded state machine for recurring contract creation.

- Day-of-week selector grid (Sun–Sat checkboxes with independent start/end times per day)
- Specific-dates mode (individual dates from mini monthly calendars)
- Real-time cost preview (cycle price, total contract value)
- Pre-flight availability check before submission
- Clash modal: blocked/conflicting dates with option to proceed or cancel

| Function | Purpose |
|---|---|
| `qbSubmitRecurringBooking(type)` | Orchestrates full pre-flight + submission flow |
| `qbIsDateBlocked(dateStr)` | Checks date against `blocked_dates` rules |
| `qbDoSubmitRecurring(payload, btns)` | POSTs to Create Recurring webhook |
| `qbProceedWithSafeDates()` | User confirms clash modal — submits conflict-free dates |
| `qbUpdateRecurrencePreview()` | Refreshes date list and cost preview in real time |

### 3.8 Design System

```css
--bg-dark:       #0f172a               /* Page background */
--bg-card:       rgba(30,41,59,0.7)    /* Card surfaces */
--border:        rgba(148,163,184,0.1)
--primary:       #6366f1               /* Indigo — primary actions */
--success:       #10b981               /* Emerald */
--warning:       #f59e0b               /* Amber */
--danger:        #ef4444               /* Red */
--text-main:     #f8fafc               /* Slate-50 */
--text-muted:    #94a3b8               /* Slate-400 */
--sidebar-width: 260px
```

### 3.9 enquiry-form.html (Public Booking Form)

**URL:** `enquiry-form.html?t=<tenant_id>` — `?t=` must parse to an integer ≥ 1000 or an error banner is shown and the form hidden. Tenant IDs below 1000 are reserved for system accounts.

**Page init (`initTenant()` IIFE):**
`GET /stripe/config?tenant_id=N` → receives `venue_name` (shown in badge and page title), `is_stripe_enabled`, `stripe_publishable_key`. Stripe deposit button is hidden unless `is_stripe_enabled` and `stripe_publishable_key` are both present.

**Data loading (parallel, via n8n):**
`get-rooms`, `get-event-types`, `blocked-dates` — all three fire in `Promise.all` on page load.

**Form fields:**
Full Name (required), Email (required), Phone (required), Preferred Room (dropdown with capacity display, required), Event Type (dropdown, required), Event Date (single) or Date From / Date To (multi-day), Start Time (08:00–23:00 in 30-min slots), End Time (same range), Number of Guests (required), Additional Rooms (checkbox list, hidden when only one room exists), Notes (optional, textarea).

**Multi-day toggle:** "Requires multiple days" button swaps the single date field for a Date From / Date To pair. Toggle state and all date fields reset fully after successful submission.

**Additional rooms:** Checkbox list shows all active rooms except the primary selection. Each checkbox label includes `+£rate/hr`. Checked rooms are included in the cost estimate and the enquiry payload (`additional_rooms` JSONB array).

**Client-side validation in `checkAvailability()` (500ms debounce before API call):**
1. Missing required fields → status stays idle
2. `dateTo < dateFrom` → error
3. `numDays > 90` → "Booking duration exceeds the 90-day maximum" (mirrors the API ceiling)
4. Any day in the range found in `blocked_dates` → "This venue is closed on YYYY-MM-DD"
5. `start >= end` → "End time must be after start time"
6. On pass → `POST /webhook/check-availability` (n8n)

**Cost calculator:** `(primary_day_rate + Σ additional_day_rates) × hours × numDays`. Note: the `day_rate` column is actually an hourly rate — the column name is historical. Display format: `£X/hr [+ N rooms] × Hh [× N days]`. Deposit = 20% of total, clamped to £10–£500.

**Submit paths (two buttons):**

*Free enquiry (`submitEnquiry()`)* — state lock → `form.checkValidity()` → capacity guard (toast, not `alert()`) → `POST /enquiry/create-request` with `status:'pending'`, `payment_method:'Enquiry — Free Request'`, `deposit_intent:false` → success panel shown (form hidden, "Submit Another Enquiry" button resets everything) → fire-and-forget `POST /webhook/enquiry-received-email`.

*Stripe deposit (`submitWithDeposit()`)* — same guards → `POST /enquiry/create-request` with `status:'pending_deposit'`, `deposit_intent:true` → fire-and-forget email → `POST /stripe/public-session` with `booking_request_id`, `amount`, `success_url` (includes `?venue=<encoded>&booking=<id>`) → redirect to Stripe Checkout.

**API constants (declared first per Rule F1):**
```javascript
const CHECK_API   = 'https://n8n.srv1090894.hstgr.cloud/webhook/check-availability';
const BASE_API    = 'https://n8n.srv1090894.hstgr.cloud/webhook';
const BLOCKED_API = 'https://n8n.srv1090894.hstgr.cloud/webhook/blocked-dates';
const EF_DB_API   = 'https://api.venuedesk.co.uk';
const SUBMIT_API  = `${EF_DB_API}/enquiry/create-request`;
```

### 3.10 checkout.html (Stripe Return Page)

**URL params:** `?session_id=` (Stripe), `?venue=` (venue name, URL-encoded), `?booking=` (booking_request_id).

**Venue name:** Set via `element.textContent = decodeURIComponent(venue)` — XSS safe. Falls back to "our venue" if `?venue=` absent.

**Booking reference strip:** Shown only when `?booking=` is present (surfaces the ID for customer support queries).

**CTA logic:**
- Staff (`vp_token` present in sessionStorage) → "Back to Dashboard" shown, "Close Window" hidden
- Public (no session) → "Close Window" shown (links to enquiry form), "Back to Dashboard" hidden

**No API calls.** Static landing page — does not verify the Stripe session server-side. The Stripe webhook handles payment recording independently.

### 3.11 onboarding.html (Tenant Lifecycle CRM — Super-Admin)

**URL:** `onboarding.html` — admin key gate, no JWT. Login POSTs `{ admin_key }` to n8n `onboarding/login` webhook → db-api validates key → `sessionStorage.setItem('vd_admin_auth', '1')`.

**Auth model:** Separate from the vp_token JWT system. The `AUTH` constant (`'vp-api-2026-Kj9mXqR4wZ'`) is visible in browser source — intentional for this admin-only utility. Session expires on browser close (sessionStorage).

**Features:**
- Venues table with subscription status badges (active/trial/past_due), seats pill (`Seats: X/Y`), action buttons per row
- Create venue modal (name, slug, contact name, tenant ID, seat stepper)
- Edit venue modal — pre-fills from current data
- Toggle active/inactive with confirmation
- Reset staff password modal (minimum length enforced client-side)
- Enquiry link copy (copies `enquiry-form.html?t=<id>` to clipboard)
- Telemetry panel: DB health dot (set by venue load success/fail), API latency (round-trip to `GET /health/ping` every 30s)
- System Audit modal — fetches `GET /onboarding/system-logs?admin_key=<AUTH>` via n8n proxy, renders timestamp/action/tenant/admin/details grid

**Seat stepper + pricing formula:** `total = 30 + Math.max(0, seats - 1) * 5`. Stepper clamped 1–20.

**n8n workflow:** `OnboardingManager.json` (v3). All write nodes use `$env.ONBOARDING_ADMIN_KEY` (not the frontend plain-text key — see Pattern 24 in CLAUDE.md).

### 3.12 admin-config.html — Tab Reference

Eight tabs, each loading data from the relevant backend:

| Tab | Backend | Key endpoints |
|---|---|---|
| Rooms | n8n webhook | `get-rooms`, `create-room`, `update-room`, `delete-room` |
| Event Types | n8n webhook | `get-event-types`, `create-event-type`, `update-event-type`, `delete-event-type` |
| Pricing Grid | n8n webhook | `get-pricing`, `set-pricing`, `delete-pricing` |
| Services | db-api direct | `GET /config/services`, `POST /config/services/upsert`, `POST /config/services/delete` |
| Settings | n8n webhook | `get-settings`, `update-setting` |
| Cancellation Policy | n8n webhook | `update-setting` (3× parallel via `Promise.all`) |
| Policy Templates | db-api direct | `GET /config/policy-templates`, `POST /config/policy-templates/upsert` |
| Payments | db-api direct | `POST /admin/payment-settings/load`, `POST /admin/payment-settings/save` |

The Rooms tab includes the hierarchical space partitioning UI: a "Parent Room / Anchor Space" collapsible section with parent dropdown and partition selectors (Halves/Thirds/Quarters). Partition position options regenerate when "Divide Into" changes. The rooms table shows parent rooms with an "N partition(s)" badge and child rooms with a `⊢ Parent Name · Nth Half/Third/Quarter` sub-label.

---

## 4. Backend — db-api (Fastify)

### 4.1 Overview

`venuedesk-api` is a Node.js / Fastify service that owns all authenticated database access, JWT issuance, and Stripe integration. It runs in a Docker container on the VPS behind Traefik.

**Source:** `venue_desk_backup/venuedesk-api/src/`

```
venuedesk-api/src/
├── server.js                  Entry point — plugins, routes, boot
├── db/
│   ├── pool.js                Two-pool architecture (appPool + systemPool)
│   ├── migrate.js             Auto-migration runner on boot
│   ├── migrations/            Numbered .sql files (001–028)
│   └── withTenantContext.js   Transaction wrapper — sets RLS tenant context
├── middleware/
│   └── errorHandler.js        Global Fastify error handler
├── services/
│   └── LoggerService.js       Writes to bookings.system_logs
├── utils/
│   ├── errors.js              HttpError factory (notFound, conflict, badRequest…)
│   ├── validators.js          assertUUID, assertRequired, assertEmail, isUUID
│   └── format.js              Formatting helpers
└── routes/
    ├── auth.js                POST /auth/login — issues JWT
    ├── dashboard.js           GET  /dashboard/* — KPIs, bookings, revenue
    ├── bookings.js            Booking lifecycle endpoints
    ├── payments.js            Payment read endpoints
    ├── payments-manual.js     POST /payments/pay — atomic balance settlement
    ├── customers.js           Customer CRUD + interactions
    ├── accounts.js            Financial overview
    ├── recurring.js           Recurring series + payments
    ├── leads.js               Lead generation
    ├── users.js               GET /users — staff list
    ├── users-update.js        POST /users/update — staff write ops
    ├── admin.js               Payment settings, audit log, system logs
    ├── config.js              Rooms, event types, pricing, settings, services, policy templates
    ├── onboarding.js          Tenant setup and management
    ├── health.js              /health/ping (public) + /health/pulse (JWT cron)
    ├── stripe.js              Stripe Checkout + webhook
    ├── enquiry.js             POST /enquiry/create-request (public)
    ├── audit.js               POST /audit/log — write audit entries
    └── blocked-dates.js       Blocked date rules CRUD
```

### 4.2 Key Fastify Configuration

**Raw body capture** — required for Stripe webhook HMAC verification:

```javascript
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  req.rawBody = body;   // exact bytes Stripe signed
  try { done(null, JSON.parse(body.toString('utf8'))); }
  catch (err) { err.statusCode = 400; done(err, undefined); }
});
```

**CORS** — `allowedHeaders: ['Content-Type']` only. `Authorization` excluded intentionally — JWT travels via body/query from browsers.

**JWT** — `@fastify/jwt`, HS256, expiry from `JWT_EXPIRY` env var (default `60m`).

**`fastify.authenticate` decorator** — tries `Authorization` header first (n8n/Postman/curl), falls back to `body.jwt` / `query.jwt`. Validates `user_id || id` and `tenant_id`; rejects with 401 if either missing.

**AJV configuration:** `coerceTypes: true`, `useDefaults: true`, `removeAdditional: true`. Never use `anyOf: [{ type: 'integer', minimum: N }, { type: 'null' }]` for optional numeric fields — AJV coerces falsy integers (e.g. `0`) to `null` via the null branch (Pattern 8 in CLAUDE.md).

### 4.3 Database Pools

Two pools — never mix them:

| Pool | Role | `max` | Use for |
|---|---|---|---|
| `appPool` | `venuedesk_app` (restricted — FORCE RLS) | 20 | All user-facing routes via `withTenantContext` |
| `systemPool` | `n8n` superuser (bypasses RLS) | 5 | Migrations, DDL, cross-tenant scheduled jobs |

**Do not use in routes running on `appPool`/`withTenantContext`:**
- `SELECT ... FOR UPDATE` — triggers RLS UPDATE policy evaluation → 500
- `pg_advisory_xact_lock` — `venuedesk_app` lacks `pg_catalog` EXECUTE → 500
- Any DDL (CREATE, ALTER, DROP)

### 4.4 `withTenantContext` Pattern

```javascript
async function withTenantContext(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

`set_config(..., true)` scopes the setting to the current transaction (= `SET LOCAL`). **Never use `SET LOCAL $1`** — PostgreSQL does not accept parameterised SET commands (error `42601`). The `tenantId` argument must be `.toString()` — `set_config` only accepts text.

`tenant_id` for write operations always comes from `req.user.tenant_id` (JWT claim) — never from the request body.

### 4.5 Password Hashing

```
hash = SHA512('vp-pepper-change-me' + plaintext_password)  →  128-char hex string
```

Default pepper is `'vp-pepper-change-me'` — both `auth.js` and `onboarding.js` fall back to this value when `PASSWORD_PEPPER` env var is not set. **Do not change the pepper** — it invalidates all existing passwords. Any account created when `onboarding.js` used the wrong fallback (`'vp-pepper-change-me-in-env'`) needs a password reset.

### 4.6 Migrations

Files `001_*.sql` through `028_*.sql` run automatically on container start via `src/db/migrate.js`. Files run in lexicographic order by filename. Never renumber existing files — the runner tracks executed migrations by filename.

**Next migration number: `029`**

| Migration | Description |
|---|---|
| `001–015` | Core schema — all tables, indexes, triggers |
| `016_tenants_rls_policy.sql` | RLS policy on `bookings.tenants` |
| `017_booking_requests_enquiry_fields.sql` | `hire_type`, `total_cost`, `event_type`, `notes` + UNIQUE `(email, tenant_id)` on customers |
| `018_booking_requests_deposit_intent_additional_rooms.sql` | `deposit_intent BOOLEAN`, `additional_rooms JSONB DEFAULT '[]'` on `booking_requests`; partial index on deposit_intent=true rows |
| `019_booking_requests_calc_fields.sql` | `total_hours NUMERIC(5,2)`, `estimated_cost DECIMAL(10,2)`, `deposit_amount DECIMAL(10,2)` on `booking_requests`; idempotent type-recast guards |
| `020_per_cycle_payment.sql` | Per-cycle payment schema: `recurring_series.cycle_length_weeks`, `card_on_file_at`; `recurring_payment_schedule` Stripe retry tracking (`stripe_session_id`, `attempt_count`, `last_attempt_at`); status enum extended to include `sent`/`failed`; `confirmed_bookings.payment_schedule_id` FK; `customers.stripe_customer_id`, `default_payment_method_id` |
| `021_payments_payment_type_cycle.sql` | Extends `payments.valid_payment_type` CHECK to include `cycle` (for Feature C per-cycle Stripe billing) |
| `022_confirmed_bookings_unique_slot.sql` | Partial unique index: `(room_id, booking_date, start_time, end_time) WHERE status NOT IN ('cancelled')` — race condition defence; `/bookings/create` catches `23505` → 409 |
| `023_policy_templates.sql` | `bookings.policy_templates (tenant_id, code, body)` — UNIQUE(tenant_id, code), RLS enforced + forced, `venuedesk_app` granted CRUD |
| `024_add_room_hours.sql` | `open_time TIME DEFAULT '08:00:00'`, `close_time TIME DEFAULT '17:00:00'` on `bookings.rooms` |
| `025_room_hours_nulldefault.sql` | `ALTER COLUMN open_time/close_time SET DEFAULT NULL`; resets rooms carrying the 024 placeholder values to NULL (unconstrained) |
| `026_admin_audit_log.sql` | Creates `bookings.admin_audit_log` (super-admin action log) and `bookings.system_health` (n8n cron telemetry snapshots) |
| `027_tenants_contact_name.sql` | `contact_name TEXT` on `bookings.tenants`; `GET /onboarding/venues` reads `COALESCE(t.contact_name, u.full_name)` |
| `028_add_room_hierarchy.sql` | `parent_room_id UUID REFERENCES bookings.rooms(id) ON DELETE SET NULL`, `partition_order INTEGER`, `partition_total INTEGER` on `bookings.rooms`; `chk_no_self_parent`, `chk_partition_consistency` constraints; `idx_rooms_parent_room` partial index |

### 4.7 Health Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | None | Docker health check: `{status:"ok"}` — also in `server.js` |
| GET | `/health/ping` | None | Latency target for onboarding telemetry: `{ok:true, ts:"..."}` — no DB round-trip |
| POST | `/health/pulse` | JWT | n8n `Cron: Health Pulse` (every 5 min) writes heartbeat to `bookings.system_health` |

---

## 5. Backend — n8n Workflows

### 5.1 Current Role

n8n is **orchestration-only**. No Postgres nodes. No raw SQL. All database operations go via db-api HTTP Request nodes.

**N8N_SERVICE_JWT multi-tenant isolation fix (June 2026):** Previously, `N8N_SERVICE_JWT` (which has `tenant_id: 1001` hardcoded) was used as the Authorization header for all n8n → db-api nodes. This locked RLS context to tenant 1001 for every user. Fixed across 10 workflows — all user-facing nodes now forward the user's own JWT. Phase 2 violations: 0.

`N8N_SERVICE_JWT` is now only correct for: scheduled/cron jobs (BillingCycle, PaymentChaser, RecurringGenerator), server-to-server operations not scoped to a specific user, and the `POST /admin/audit-log` fan-out.

**Base webhook URL:** `https://n8n.srv1090894.hstgr.cloud/webhook`

### 5.2 Active Workflow Index

| File | n8n ID | Workflow Name | Key Paths |
|---|---|---|---|
| `hBclMCxbgmz7f3Za_clean.json` | — | Complete System API | `staff-dashboard`, `all-customers`, `accounts-data`, `pending-requests`, `monthly-revenue`, `update-status`, `cancel-pending` |
| `tafp1WtWgLvRY3HC.json` | — | Config Manager | `get-rooms`, `create-room`, `update-room`, `delete-room`, `get-event-types`, `create-event-type`, `get-pricing`, `set-pricing`, `delete-pricing`, `get-settings`, `update-setting` |
| `nW4p6cg3l7OHwjQP_clean.json` | `WPG6q8AOrs9ooxbB` | Customer Interactions API | `customer-interactions` (GET + POST) |
| `OnboardingManager.json` | — | Onboarding Manager v3 | `onboarding/login`, `onboarding/venues`, `onboarding/create-venue`, `onboarding/toggle-venue`, `onboarding/update-venue`, `onboarding/reset-password`, `onboarding/system-logs` |
| `NewEnquiryNotification.json` | `Jh6nCEqLVFONT8IB` | New Enquiry Notification | `enquiry-received-email` |
| `BillingCycleTrigger.json` | `B0Nuq8kTqfT4f0Sx` | Pending Lifecycle Scheduler | Daily 08:00 — 4–7 day expiry warnings to customers |
| `RecurringBookingGenerator.json` | — | Recurring Booking Generator | Scheduled recurring booking creation |
| `PendingLifecycleScheduler.json` | — | Pending Lifecycle Scheduler | Payment chasing automation |
| `RecurringAutoCancel.json` | — | Recurring Auto-Cancel | 60+ day auto-cancel |
| `RecurringPaymentReminder.json` | — | Recurring Payment Reminder | Scheduled reminders |
| `XKKG5SZ75bHg35Zt.json` | — | (Cron) | Health pulse + other scheduled tasks |
| `Cei912AKyQBPOM9j` (n8n ID) | — | Cancel Booking (Series Support) | `cancel-booking`, series support |
| `KqSekNRSeXpKh5pJ` (n8n ID) | — | User Manager | User CRUD via db-api |
| `FWkK7gqWxKz4funf` (n8n ID) | — | Recurring Make Booking | `make-booking` (recurring) |
| `hhOxbWh7mW2tbyC5` (n8n ID) | — | Cancellation Manager | `cancel-booking` |
| `MXCss5PTB3YpiQuV` (n8n ID) | — | VenuePro - Confirm Booking | `confirm-booking` — sends confirmation email |
| `qqmg9R1HRZdsljgt` (n8n ID) | — | Financial Operations (Stripe + Manual Fork) | `pay-balance` — forks on payment method; Stripe path has safety gate |

**Archived workflows (defunct — no frontend callers):**
- `ZFbEUOuAq5AVy8a5` (Add Recurring Rule) — archived June 2026
- `fZMBcIn9LpoE9D9B` (Recurring Walk-In Booking) — archived June 2026
- `4ZLKQsWZBgDalvok` (Get Outstanding Payments) — archived June 2026; replaced by direct db-api call from `index.html` and `audit-log.html`

### 5.3 Recurring Booking Workflow Structure

```
Webhook
  → Code: Parse + Validate
  → HTTP: Check Clashes      (POST /bookings/check-clashes on db-api)
  → Code: Filter Dates       (remove clashing/blocked)
  → HTTP: Upsert Customer    (POST /customers/upsert on db-api)
  → HTTP: Insert Series      (POST /recurring/create on db-api)
  → HTTP: Insert Bookings    (bulk POST — NOT EXISTS guard in db-api)
  → Respond: Created / Not Available
```

### 5.4 Clash Detection SQL (n8n workflows)

The recurring workflows call db-api clash-check endpoints which internally run overlap queries. The n8n workflows no longer execute SQL directly. The db-api `/bookings/check-clashes` endpoint uses the recursive CTE hierarchy conflict set (see §10.4).

### 5.5 Email Notification Workflows

Five automated email triggers cover the full booking lifecycle:

| Trigger | Workflow | n8n ID | Recipients | Header colour |
|---|---|---|---|---|
| Customer submits enquiry | New Enquiry Notification | `Jh6nCEqLVFONT8IB` | Customer (acknowledgement) + Staff (alert with dashboard link) | Indigo / Dark slate |
| Staff confirm pending request | VenuePro - Confirm Booking | `MXCss5PTB3YpiQuV` | Customer (booking confirmation with payment summary) | Green |
| Cash/BACS/card payment recorded | Financial Operations | `qqmg9R1HRZdsljgt` | Customer (receipt — 4 variants: deposit/partial/full/BACS) | Indigo/Amber/Green |
| Stripe payment verified + recorded | Financial Operations | `qqmg9R1HRZdsljgt` | Customer (card confirmation — only after Stripe webhook records payment) | Green |
| Enquiry 4–7 days old, no deposit | Pending Lifecycle Scheduler | `B0Nuq8kTqfT4f0Sx` | Customer (expiry warning, daily 08:00) | Amber |

**SMTP:** Hostinger SMTP, `fromEmail: bookings@venuedesk.co.uk`, n8n credential `J0qWHzypu4SvoXyg`.

**Staff alert address:** Configurable per venue in `bookings.settings` key `staff_notification_email`. Read on every enquiry from `GET /stripe/config?tenant_id=N`. Falls back to `bookings@venuedesk.co.uk` in n8n Code node when setting is absent.

**Stripe email safety gate:** The Financial Operations workflow verifies payment is recorded in db-api before sending a Stripe confirmation email. Flow: `IF: Is Stripe?` → `DB: Verify Stripe Payment (GET /bookings/{id})` → `IF: Stripe Payment Recorded?` → true: build and send email; false: return HTTP 202 `STRIPE_PAYMENT_PENDING` without sending.

**Enquiry form integration:** Both submit paths in `enquiry-form.html` fire a fire-and-forget `POST` to `webhook/enquiry-received-email` immediately after a successful `/enquiry/create-request`. The notification workflow sends both emails in parallel with `Respond: OK`, so the frontend response is never delayed.

---

## 6. Database Schema

### 6.1 Schema Overview

All tables in the `bookings` schema. Every table has `tenant_id INT NOT NULL`. RLS enabled and forced on all 12 tenant-scoped tables. `withTenantContext` injects tenant context on every transaction.

### 6.2 Core Tables

#### `bookings.staff_users`

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tenant_id | INT | `1` = master/super-admin, `1001` = venue |
| username | TEXT | Login identifier |
| full_name | TEXT | Display name |
| role | TEXT | `admin` \| `staff` |
| hashed_password | TEXT | SHA512(PEPPER + plaintext) — 128-char hex |
| is_active | BOOLEAN | |

`admin` → `tenant_id = 1` (intentional — sees no venue data). Venue staff → `tenant_id = 1001`.

#### `bookings.customers`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| full_name | TEXT | |
| email | TEXT | |
| phone | TEXT | |
| event_type | TEXT | |
| event_date | DATE | |
| guests_count | INT | |
| status | TEXT | `pending` \| `contacted` \| `booked` \| `cancelled` |
| notes | TEXT | |
| warning_sent | BOOLEAN | |
| stripe_customer_id | TEXT | Stripe Customer resource (migration 020) |
| default_payment_method_id | TEXT | Most-recent card token for off-session billing (migration 020) |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `bookings.booking_requests` — Enquiry submissions

| Column | Type | Notes |
|---|---|---|
| id | UUID | Returned to frontend before any Stripe session |
| tenant_id | INT | |
| customer_id | UUID | FK → customers |
| room_id | UUID | FK → rooms |
| requested_date | DATE | |
| date_from | DATE | |
| date_to | DATE | |
| start_time | TIME | |
| end_time | TIME | |
| guest_count | INT | |
| hire_type | TEXT | Always `hourly` (column is historical — field hidden in form) |
| total_cost | NUMERIC | |
| event_type | TEXT | |
| notes | TEXT | |
| status | TEXT | `pending` \| `pending_deposit` \| `deposit_paid` \| `booked` \| `cancelled` |
| deposit_intent | BOOLEAN | `false` = free enquiry; `true` = Stripe deposit path (migration 018) |
| additional_rooms | JSONB | Array of `{ id, name, day_rate }` for extra rooms (migration 018) |
| total_hours | NUMERIC(5,2) | Computed on submission: `end_time - start_time` (migration 019) |
| estimated_cost | DECIMAL(10,2) | Computed: `hours × room.day_rate` (migration 019) |
| deposit_amount | DECIMAL(10,2) | Amount billed via Stripe (migration 019) |
| payment_method | TEXT | e.g. `'Enquiry — Free Request'` |
| payment_type | TEXT | |
| booking_source | TEXT | |

UNIQUE constraint on `(email, tenant_id)` via customer upsert path.

#### `bookings.confirmed_bookings`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| customer_id | UUID | |
| room_id | UUID | |
| booking_date | DATE | |
| date_from | DATE | |
| date_to | DATE | |
| start_time | TIME | |
| end_time | TIME | |
| guest_count | INT | |
| total_amount | NUMERIC | |
| balance_due | NUMERIC | **Always 0 when `recurring_series_id IS NOT NULL`** (trigger) |
| deposit_paid | NUMERIC | |
| deposit_amount | NUMERIC | |
| payment_status | TEXT | `pending` \| `paid` \| `overdue` \| `cancelled` |
| status | TEXT | `confirmed` \| `provisional` \| `cancelled` \| `pending` \| `deposit_paid` \| `fully_paid` \| `paid` \| `overridden` |
| is_recurring | BOOLEAN | |
| recurring_series_id | UUID | FK → recurring_series (NULL for standalone) |
| payment_schedule_id | UUID | FK → recurring_payment_schedule ON DELETE SET NULL (migration 020) |
| google_event_id | TEXT | |
| cancellation_reason | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Trigger `fn_zero_child_balance()` sets `balance_due = 0` on child INSERTs where `recurring_series_id IS NOT NULL`. All debt lives on the parent.

#### `bookings.payments`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| booking_id | UUID | FK → confirmed_bookings |
| amount | NUMERIC | |
| payment_type | TEXT | `deposit` \| `balance` \| `full` \| `refund` \| `full_payment` \| `credit_card` \| `recurring` \| `recurring_payment` \| `cycle` |
| payment_method | TEXT | `card` \| `bank_transfer` \| `cash` \| `cheque` |
| reference_number | TEXT | Stripe session ID, BACS ref, etc. |
| status | TEXT | `completed` \| `pending` \| `refunded` |

#### `bookings.recurring_series` — Parent records

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| customer_id | UUID | |
| room_id | UUID | |
| series_name | TEXT | |
| frequency | TEXT | `weekly` \| `fortnightly` \| `monthly` \| `daily` |
| day_of_week | INT | 0–6 (Sun–Sat) |
| start_time | TIME | |
| end_time | TIME | |
| start_date | DATE | |
| end_date | DATE | |
| rate_per_session | NUMERIC | Frozen at contract signing |
| sessions_per_cycle | INT | |
| total_sessions | INT | |
| cycle_amount | NUMERIC | |
| agreed_price | NUMERIC | Total contract value |
| balance_due | NUMERIC | **Debt lives here — never on children** |
| payment_timing | TEXT | `in_full` \| `in_advance` \| `in_arrears` (CHECK enforced, migration 020) |
| billing_type | TEXT | `monthly` \| `per_session` \| `upfront` |
| cycle_length_weeks | INT | 1–52 (migration 020; NULL for in_full series) |
| card_on_file_at | TIMESTAMPTZ | When Stripe PM was captured (migration 020) |
| active | BOOLEAN | |
| notes | TEXT | |

#### `bookings.rooms`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| name | TEXT | |
| capacity | INT | |
| day_rate | NUMERIC | Misnamed — this is the hourly rate |
| rate_per_hour | NUMERIC | |
| available_from | TIME | Legacy — superseded by `open_time` |
| available_to | TIME | Legacy — superseded by `close_time` |
| open_time | TIME | Per-room opening time; NULL = unconstrained (migration 024/025) |
| close_time | TIME | Per-room closing time; NULL = unconstrained (migration 024/025) |
| parent_room_id | UUID | FK → rooms ON DELETE SET NULL; NULL for standalone/parent rooms (migration 028) |
| partition_order | INTEGER | 0-based position within siblings; 0 = 1st partition (migration 028) |
| partition_total | INTEGER | Total equal parts: 2=halves, 3=thirds, 4=quarters (migration 028) |
| is_active | BOOLEAN | |

**Constraints (migration 028):**
- `chk_no_self_parent`: `id <> parent_room_id`
- `chk_partition_consistency`: both `partition_order`/`partition_total` are null together, or both are valid with `0 <= partition_order < partition_total >= 2`

#### `bookings.blocked_dates`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| block_type | TEXT | `oneoff` \| `recurring` \| `recurring-weekday` \| `range` |
| block_date | DATE | For `oneoff` |
| day_of_week | INT | For recurring types (0–6) |
| date_from | DATE | For `range` |
| date_to | DATE | For `range` |
| reason | TEXT | |

#### `bookings.settings`

| Key | Default | Description |
|---|---|---|
| `cancel_full_refund_days` | `14` | Full refund threshold |
| `cancel_partial_refund_days` | `7` | Partial refund threshold |
| `cancel_partial_refund_pct` | `50` | Partial refund percentage |
| `booking_buffer_minutes` | `60` | Buffer between bookings — always `COALESCE` in SQL |
| `staff_notification_email` | (none) | Email address for new-enquiry staff alerts; falls back to `bookings@venuedesk.co.uk` in n8n Code node |

#### `bookings.tenants`

| Column | Type | Notes |
|---|---|---|
| tenant_id | INT | Primary key |
| name | TEXT | Venue name |
| is_active | BOOLEAN | |
| is_stripe_enabled | BOOLEAN | |
| stripe_publishable_key | TEXT | |
| stripe_secret_key | TEXT | Encrypted — never returned to clients |
| stripe_webhook_secret | TEXT | Encrypted |
| contact_name | TEXT | Admin-panel contact name (migration 027); `COALESCE(t.contact_name, u.full_name)` used by `/onboarding/venues` |

#### `bookings.audit_logs`

All write operations log here: `tenant_id`, `action` (CREATE/UPDATE/CANCEL), `entity`, `entity_id`, `payload` (JSONB), `performed_by`, `created_at`.

#### `bookings.admin_audit_log` (migration 026)

Super-admin action log for the onboarding portal. Columns: `id UUID`, `admin_id TEXT`, `target_tenant INT`, `action_type TEXT`, `details TEXT`, `timestamp TIMESTAMPTZ`.

Written by n8n fan-out nodes after create/toggle/reset/update operations. Read by `GET /admin/system-logs`.

#### `bookings.system_health` (migration 026)

n8n cron telemetry snapshots from `POST /health/pulse`. Written every 5 minutes by the `Cron: Health Pulse` workflow. Displayed in onboarding telemetry panel.

#### `bookings.policy_templates` (migration 023)

Tenant-scoped cancellation/booking policy text. Columns: `tenant_id INT`, `code TEXT` (`A`/`B`/`C`), `body TEXT`. UNIQUE(tenant_id, code), RLS enforced + forced.

#### `bookings.add_on_services` (migration 010)

Per-tenant add-on services (e.g. AV equipment, catering). Managed via `GET/POST /config/services`.

### 6.3 Key Indexes

```sql
-- Core performance indexes
CREATE INDEX idx_confirmed_bookings_tenant    ON bookings.confirmed_bookings(tenant_id);
CREATE INDEX idx_confirmed_bookings_room_date ON bookings.confirmed_bookings(room_id, booking_date);
CREATE INDEX idx_confirmed_bookings_series    ON bookings.confirmed_bookings(recurring_series_id);
CREATE INDEX idx_recurring_series_tenant      ON bookings.recurring_series(tenant_id, active);
CREATE INDEX idx_customers_tenant             ON bookings.customers(tenant_id);
CREATE INDEX idx_booking_requests_tenant      ON bookings.booking_requests(tenant_id);

-- Race condition defence (migration 022)
CREATE UNIQUE INDEX idx_confirmed_bookings_room_slot
  ON bookings.confirmed_bookings (room_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled');

-- Room hierarchy (migration 028)
CREATE INDEX idx_rooms_parent_room
  ON bookings.rooms(parent_room_id)
  WHERE parent_room_id IS NOT NULL;

-- Enquiry deposit tracking (migration 018)
CREATE INDEX idx_booking_requests_deposit_intent
  ON bookings.booking_requests(tenant_id, status)
  WHERE deposit_intent = TRUE;

-- Per-cycle payment cron sweep (migration 020)
CREATE INDEX idx_rps_due_status_tenant
  ON bookings.recurring_payment_schedule(due_date, status, tenant_id);

-- Stripe customer lookup (migration 020)
CREATE INDEX idx_customers_stripe_customer
  ON bookings.customers(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
```

---

## 7. API Endpoints

### 7.1 db-api (`https://api.venuedesk.co.uk`)

#### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Verify credentials, issue JWT |

Login response:
```json
{
  "success": true,
  "token": "<JWT>",
  "user": {
    "id": "uuid", "user_id": "uuid",
    "username": "arj72", "role": "admin",
    "full_name": "Andrew Johnson", "name": "Andrew Johnson",
    "tenant_id": 1001
  }
}
```

#### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/data` | JWT | KPIs, bookings, pending requests |
| GET | `/dashboard/pending` | JWT | Pending approval queue |
| GET | `/dashboard/revenue` | JWT | Monthly revenue trend |

#### Bookings

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/bookings` | JWT | Booking list with filters |
| POST | `/bookings/create` | JWT | Create single booking (7-step validation — see §10.1) |
| POST | `/bookings/confirm` | JWT | Confirm a pending booking |
| POST | `/bookings/cancel` | JWT | Cancel with refund calculation |
| GET | `/bookings/calendar` | JWT | All events for FullCalendar |
| POST | `/bookings/check-availability` | JWT | Check slot availability |
| POST | `/bookings/check-clashes` | JWT | Multi-date clash check (recursive CTE hierarchy) |
| POST | `/bookings/clash-guard` | JWT | Pre-insert guard |

#### Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/pay` | JWT | Atomic settlement — INSERT payment + UPDATE booking in one transaction |
| GET | `/payments/outstanding` | JWT | Outstanding payment summary |
| GET | `/recurring/outstanding-payments` | JWT | Outstanding recurring payments |

#### Enquiry (Public)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/enquiry/create-request` | Public | Upsert customer + insert `booking_requests` row. Returns `{ booking_request_id, customer_id }`. Validates tenant is active. |

#### Customers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/customers` | JWT | Paginated customer list |
| POST | `/customers/update` | JWT | Update customer fields |
| GET | `/customers/:id` | JWT | Single customer |
| GET | `/customers/interactions` | JWT | Customer interaction history (by `customer_id` or `email`) |
| POST | `/customers/log-interaction` | JWT | Insert interaction record |

#### Staff Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | JWT | Staff list for tenant |
| POST | `/users/create` | JWT | Create staff user (SHA512+PEPPER hash) |
| POST | `/users/update` | JWT | Update name, role, optional password |
| POST | `/users/delete` | JWT | Remove staff user |

#### Config

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/config/rooms` | JWT | Room list — returns `open_time`, `close_time`, `parent_room_id`, `partition_order`, `partition_total` |
| POST | `/config/rooms/create` | JWT | Create room with optional hours + hierarchy fields |
| POST | `/config/rooms/update` | JWT | Update room; blank `open_time`/`close_time` clears to NULL |
| POST | `/config/rooms/delete` | JWT | Soft-delete room |
| GET | `/config/event-types` | JWT | Event types |
| POST | `/config/event-types/create` | JWT | Create event type |
| POST | `/config/event-types/update` | JWT | Update event type |
| POST | `/config/event-types/delete` | JWT | Soft-delete event type |
| GET | `/config/pricing` | JWT | Room × event pricing grid |
| POST | `/config/pricing/upsert` | JWT | Insert or update pricing override |
| POST | `/config/pricing/delete` | JWT | Delete pricing override |
| GET | `/config/settings` | JWT | All settings for tenant |
| POST | `/config/settings/upsert` | JWT | Insert or update a single setting key |
| GET | `/config/services` | JWT | Add-on services |
| POST | `/config/services/upsert` | JWT | Insert or update a service (UUID id required) |
| POST | `/config/services/delete` | JWT | Delete a service by UUID |
| GET | `/config/policy-templates` | JWT | Policy templates (codes A/B/C) |
| POST | `/config/policy-templates/upsert` | JWT | Upsert a policy template by `(tenant_id, code)` |

#### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/payment-settings/load` | JWT (admin) | Load Stripe/BACS config; returns presence flags, not raw secrets |
| POST | `/admin/payment-settings/save` | JWT (admin) | Update Stripe/BACS keys; empty string = skip (leave unchanged) |
| POST | `/admin/audit-log` | JWT (admin) | Write onboarding admin action to `admin_audit_log` |
| GET | `/admin/system-logs` | JWT (admin) | Read `admin_audit_log`; optional `?limit=` and `?action_type=` filters |

#### Onboarding

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/onboarding/login` | `admin_key` (body) | Validate admin key |
| GET | `/onboarding/venues` | `X-Admin-Key` header | All tenants — returns `COALESCE(t.contact_name, u.full_name) AS full_name` |
| POST | `/onboarding/create-venue` | `X-Admin-Key` header | Create tenant + staff user |
| POST | `/onboarding/toggle-venue` | `X-Admin-Key` header | Activate / deactivate tenant |
| POST | `/onboarding/update-venue` | `X-Admin-Key` header | Update venue name + contact_name on tenants table |
| POST | `/onboarding/reset-password` | `X-Admin-Key` header | Reset staff user password |

#### Blocked Dates

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/blocked-dates` | JWT | Blocked date rules for tenant |
| POST | `/blocked-dates/create` | JWT | Add block rule |
| POST | `/blocked-dates/delete` | JWT | Remove block rule |

#### Audit

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/audit/log` | JWT | Write audit entry |
| GET | `/audit/log` | JWT | Read audit history |

#### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | `{ status: "ok", ts: "..." }` — Docker health check |
| GET | `/health/ping` | None | `{ok:true, ts:"..."}` — no DB round-trip; latency target for onboarding panel |
| POST | `/health/pulse` | JWT | n8n cron heartbeat → `bookings.system_health` |

#### Recurring

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recurring` | JWT | Active recurring series |
| POST | `/recurring/pay` | JWT | Record payment on series parent |
| POST | `/recurring/cancel` | JWT | Cancel series + all children |

#### Stripe

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/stripe/config` | Public | `is_stripe_enabled`, `stripe_publishable_key`, `venue_name`, `staff_notification_email` |
| GET | `/stripe/bacs-details` | JWT (query) | BACS account details |
| POST | `/stripe/session` | JWT | Create Checkout session (dashboard staff) |
| POST | `/stripe/public-session` | Public | Create Checkout session (enquiry form — £10–£500 deposit bounds enforced) |
| POST | `/stripe/webhook` | Stripe sig | Payment confirmation; updates `booking_requests.status` or `confirmed_bookings.balance_due` |

### 7.2 Standard POST Pattern

```javascript
{
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jwt:       sessionStorage.getItem('vp_token') || '',
    tenant_id: parseInt(sessionStorage.getItem('vp_tenant_id') || '0'),
    // ... fields
  })
}
```

### 7.3 n8n Webhook Endpoints

Base: `https://n8n.srv1090894.hstgr.cloud/webhook`

| Path | Method | Description |
|---|---|---|
| `confirm-booking` | POST | Confirm pending request → sends confirmation email |
| `cancel-booking` | POST | Cancel with refund calc |
| `create-recurring-booking` | POST | Recurring series creation |
| `check-recurring-clashes` | POST | Pre-flight availability |
| `check-availability` | POST | Slot availability (used by enquiry form) |
| `get-recurring-bookings` | GET | Active series list |
| `customer-interactions` | GET + POST | Activity log (routes to db-api `/customers/interactions` and `/customers/log-interaction`) |
| `get-rooms` | GET | Room list (Config Manager workflow) |
| `get-event-types` | GET | Event type list |
| `get-pricing` | GET | Pricing grid |
| `get-settings` | GET | Tenant settings |
| `update-setting` | POST | Update single setting key |
| `blocked-dates` | GET | Blocked date rules |
| `staff-dashboard` | POST | Dashboard KPIs |
| `all-customers` | POST | Customer list |
| `accounts-data` | POST | Financial overview |
| `monthly-revenue` | POST | Revenue trend |
| `pay-balance` | POST | Legacy manual payment (forks to Financial Operations) |
| `enquiry-received-email` | POST | Fire-and-forget email notifications on enquiry submission |
| `onboarding/*` | Mixed | Onboarding Manager (see §3.11) |

### 7.4 Standard Response Shapes

```json
// Successful booking
{ "status": "created", "booking_count": 24, "series_id": "uuid", "partial_booking": false }

// Partial booking (some dates clashed)
{ "status": "created", "booking_count": 16, "partial_booking": true,
  "warning": "Series cut short — 2026-06-09 is already booked.", "first_conflict_date": "2026-06-09" }

// Not available
{ "status": "not_available", "message": "The first session date is already booked." }

// db-api error shape
{ "success": false, "code": "VALIDATION_ERROR", "message": "..." }
```

---

## 8. Authentication & Security

### 8.1 JWT Payload (Issued by `auth.js`)

```json
{
  "id":        "uuid",
  "user_id":   "uuid",
  "username":  "arj72",
  "role":      "admin",
  "full_name": "Andrew Johnson",
  "name":      "Andrew Johnson",
  "tenant_id": 1001,
  "iat":       1747000000,
  "exp":       1747003600
}
```

Both `id` and `user_id` are set for backward compatibility. `name` is an alias for `full_name`. `fastify.authenticate` normalises `id` → `user_id` and rejects with 401 if `user_id` or `tenant_id` is missing.

### 8.2 Security Status

| Concern | Status |
|---|---|
| JWT issuance | db-api `auth.js` — n8n no longer in auth path |
| `tenant_id` source | JWT claim only — never from request body for writes |
| CORS | `Content-Type` only — `Authorization` excluded |
| JWT body-tunnel | All browser calls embed token in body or query string |
| Stripe HMAC | `req.rawBody` (Buffer) + `.trim()`'d secret |
| RLS | `set_config('app.tenant_id', ...)` in every transaction via `withTenantContext` |
| Password hashing | SHA512 + PEPPER — 128-char hex |
| Token expiry | 60 minutes (`JWT_EXPIRY` env var) |
| localStorage audit | ✅ Complete (June 2026) — all auth/identity keys migrated to sessionStorage |
| N8N_SERVICE_JWT isolation | ✅ Fixed (June 2026) — all user-facing n8n nodes forward user JWT; Phase 2 violations: 0 |
| Onboarding admin key | Separate from JWT — `vd_admin_auth` in sessionStorage; expires on browser close |
| RLS enforcement | Substantially complete — all 12 tenant tables have RLS enabled + forced |
| Rate limiting | Pending Phase 5 |
| Token refresh | Pending Phase 5 — re-login required on 60-min expiry |
| Postgres host port | Pending Phase 5 — `5432:5432` exposes DB; remove `ports:` block in production |

### 8.3 Cancellation Refund Policy

| Days Until Booking | Refund |
|---|---|
| ≥ `cancel_full_refund_days` (default: 14) | 100% |
| ≥ `cancel_partial_refund_days` (default: 7) | `cancel_partial_refund_pct`% (default: 50%) |
| < 7 days | 0% (forfeit) |

---

## 9. Stripe Integration

### 9.1 Dashboard Card Payment

```
Staff selects "Card" in pay modal
  → GET /stripe/config         (publishable key + enabled flag)
  → Button swaps to "Generate Payment Link"
  → POST /stripe/session       (JWT body-tunnel)
  → Redirect to Stripe Checkout
  → Return URL → checkout.html?session_id=<id>&venue=<name>
  → POST /stripe/webhook       (signature verified — rawBody + trimmed secret)
  → UPDATE confirmed_bookings.balance_due + status
```

### 9.2 Enquiry Form Deposit

```
Customer fills enquiry-form.html?t=<tenant_id>
  → GET /stripe/config?tenant_id=N    venue name + Stripe state + staff_notification_email
  → loadRoomsAndTypes()               rooms/event-types/blocked-dates in parallel (n8n)
  → checkAvailability()               real-time slot check (500ms debounce, n8n)

Two submit paths:

Path A — Free enquiry:
  → POST /enquiry/create-request      { status:'pending', deposit_intent:false }
    → returns { booking_request_id, customer_id }
  → fire-and-forget POST /webhook/enquiry-received-email
  → success panel shown

Path B — Stripe deposit:
  → POST /enquiry/create-request      { status:'pending_deposit', deposit_intent:true }
    → returns { booking_request_id, customer_id }
  → fire-and-forget POST /webhook/enquiry-received-email
  → POST /stripe/public-session       amount=20% of estimate (£10–£500 clamped)
    success_url includes ?venue=<name>&booking=<booking_request_id>
  → Redirect to Stripe Checkout
  → checkout.html?session_id=...&venue=...&booking=...
  → Stripe webhook → booking_requests.status = 'deposit_paid'
```

`booking_request_id` must be captured from `/enquiry/create-request` before creating the Stripe session — the webhook uses it to link the payment to the correct request.

### 9.3 BACS Payment

```
Staff selects "Bank Transfer"
  → GET /stripe/bacs-details?jwt=<token>
  → POST /payments/pay   (atomic settlement)
```

### 9.4 Webhook Integrity

```javascript
const secret = process.env.STRIPE_WEBHOOK_SECRET.trim();  // strip Docker \n
event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
// Never pass JSON.stringify(req.body) — breaks HMAC
// req.rawBody is the exact Buffer captured by addContentTypeParser
```

The Stripe path in the Financial Operations workflow verifies payment is recorded in db-api before sending a confirmation email (Pattern 28 — Stripe email safety gate).

---

## 10. Booking Logic & Data Flows

### 10.1 `/bookings/create` — 7-Step Validation Chain

```
POST /bookings/create → withTenantContext transaction:

1. Past-date guard
   booking_date / date_from < today (today anchored to UTC midnight via Date.UTC() — BST safe)
   → 400 if in the past

2. Duration ceiling
   (date_to − date_from) > 90 days computed via parseUTC() (UTC-anchored)
   → 400 if exceeded

3. guest_count guard
   provided and < 1 → 400

4. Room lookup + capacity ceiling
   SELECT id, capacity, open_time, close_time FROM bookings.rooms WHERE id=$1 AND tenant_id=$2
   guest_count > room.capacity → 400 (skipped if capacity = 0)

5. Room hours enforcement
   start_time < room.open_time → 400 "This room does not open until HH:MM"
   end_time > room.close_time  → 400 "This room closes at HH:MM"
   (skipped if open_time/close_time IS NULL — unconstrained)

6. Clash check — recursive CTE conflict_set
   Resolves ancestor/descendant/overlapping-sibling rooms (see §10.4)
   Overlap query: start < end AND end > start → 409 CONFLICT

7. INSERT confirmed_bookings
   Catches PostgreSQL 23505 (unique slot violation from idx_confirmed_bookings_room_slot)
   → 409 (second race condition defence)

HTTP 200 only after COMMIT
```

### 10.2 Recurring Booking (n8n — calls db-api)

Parent-child architecture: one `recurring_series` row holds all debt; N `confirmed_bookings` children have `balance_due = 0`.

```
1. Frontend: generate candidate dates, filter blocked_dates client-side
2. POST /webhook/check-recurring-clashes → n8n → db-api /bookings/check-clashes
3. Clash modal if needed (proceed with safe dates or cancel)
4. POST /webhook/create-recurring-booking → n8n → db-api:
   - Re-check clashes server-side
   - INSERT recurring_series (1 parent)
   - Bulk INSERT confirmed_bookings (NOT EXISTS guard in db-api)
   - Returns { booking_count, partial_booking, first_conflict_date }
```

### 10.3 Atomic Payment Settlement

`POST /payments/pay` — both writes commit or both roll back:

```sql
INSERT INTO bookings.payments (...) VALUES (...);

UPDATE bookings.confirmed_bookings
SET balance_due  = GREATEST(0, COALESCE(balance_due, 0) - $amount),
    deposit_paid = COALESCE(deposit_paid, 0) + $amount,
    status       = CASE
                     WHEN GREATEST(0, COALESCE(balance_due, 0) - $amount) <= 0 THEN 'confirmed'
                     ELSE COALESCE(NULLIF(status, 'pending'), 'provisional')
                   END,
    updated_at   = NOW()
WHERE id = $booking_id AND tenant_id = $tenant_id;
```

### 10.4 Hierarchical Space Partitioning (migration 028)

Rooms can be marked as children of a parent with a fractional position `[partition_order / partition_total, (partition_order + 1) / partition_total]`. A booking on any room in a tree blocks the entire ancestor chain AND any sibling whose fractional footprint overlaps.

All four clash-check paths (`/bookings/create`, `/bookings/check-clashes`, `/bookings/clash-guard`, `/bookings/check-availability`) run a `WITH RECURSIVE conflict_set(id)` CTE to determine the full conflict set before querying `confirmed_bookings`:

```sql
WITH RECURSIVE conflict_set(id) AS (
  -- Seed: target room itself
  SELECT id, parent_room_id, partition_order, partition_total
  FROM bookings.rooms WHERE id = $target_room_id

  UNION ALL

  -- Ancestors: parent → grandparent chain
  SELECT r.id, r.parent_room_id, r.partition_order, r.partition_total
  FROM bookings.rooms r
  JOIN conflict_set c ON r.id = c.parent_room_id

  UNION ALL

  -- Descendants: children → grandchildren chain
  SELECT r.id, r.parent_room_id, r.partition_order, r.partition_total
  FROM bookings.rooms r
  JOIN conflict_set c ON r.parent_room_id = c.id

  UNION ALL

  -- Overlapping siblings (integer cross-multiplication — avoids float drift)
  SELECT s.id, s.parent_room_id, s.partition_order, s.partition_total
  FROM bookings.rooms s
  JOIN conflict_set t ON s.parent_room_id = t.parent_room_id
  WHERE s.id <> t.id
    AND s.partition_order IS NOT NULL AND t.partition_order IS NOT NULL
    AND (s.partition_order * t.partition_total) < (t.partition_order + 1) * s.partition_total
    AND (t.partition_order * s.partition_total) < (s.partition_order + 1) * t.partition_total
)
SELECT cb.id FROM bookings.confirmed_bookings cb
JOIN conflict_set cs ON cb.room_id = cs.id
WHERE cb.status NOT IN ('cancelled')
  AND cb.start_time < $end_time AND cb.end_time > $start_time
  AND ...  -- date overlap
```

This correctly detects: 2nd Half + 3rd Quarter overlap (physical footprints intersect); 1st Half + 3rd Quarter are bookable simultaneously (non-overlapping). Any booking on a child room blocks the parent room, and vice versa.

**QA results (June 27 2026):** 28/28 hierarchy e2e tests passing — halves (7/7), thirds isolation (5/5), quarters isolation (6/6), cross-level thirds × quarters (10/10).

### 10.5 Room Hours Enforcement

`bookings.rooms.open_time` / `close_time` (TIME, nullable). NULL = unconstrained (venue-wide operating window applies).

Enforced in `/bookings/create` step 5 after capacity check:

```javascript
const toHHMM = t => String(t).slice(0, 5);
if (room.open_time && start_time.slice(0, 5) < toHHMM(room.open_time))
  throw badRequest(`This room does not open until ${toHHMM(room.open_time)}.`);
if (room.close_time && end_time.slice(0, 5) > toHHMM(room.close_time))
  throw badRequest(`This room closes at ${toHHMM(room.close_time)}.`);
```

`calendar.html` respects per-room hours in the quick-book panel via `_getRoomWindow(roomName)` (falls back to `VENUE_OPEN_MINS`/`VENUE_CLOSE_MINS` when NULL).

`enquiry-form.html` does not enforce room hours client-side — the API enforces on submission.

### 10.6 UTC Date Guards (Pattern 12)

All date comparisons in `/bookings/create` use UTC-anchored arithmetic to avoid BST/DST boundary errors on the VPS (which runs `Europe/London`):

```javascript
// "today" anchored to UTC midnight — prevents BST drift shifting the past-date boundary
const _now    = new Date();
const todayMs = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate());
const today   = new Date(todayMs).toISOString().slice(0, 10);  // YYYY-MM-DD UTC

// Duration ceiling — months are 0-indexed in Date.UTC()
const parseUTC     = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msPerDay     = 86_400_000;
const durationDays = Math.round((parseUTC(date_to) - parseUTC(date_from)) / msPerDay);
if (durationDays > 90) throw badRequest('Booking duration exceeds maximum allowed limit of 90 days.');
```

Never construct `new Date('YYYY-MM-DD')` — bare date string construction uses implicit local TZ.

### 10.7 Payment Chasing (n8n — scheduled)

```
BillingCycleTrigger (daily 08:00)
  4–7 days since enquiry, no deposit  → expiry warning email (amber template)
  1–30 days overdue (recurring)       → reminder email
  30–60 days overdue (recurring)      → escalation email
  60+ days overdue (recurring)        → auto-cancel: series.active = false, children status = 'cancelled'
```

---

## 11. Multi-Tenancy

Every table has `tenant_id INT NOT NULL`. Three layers enforce isolation:

**JWT layer:** `tenant_id` from verified JWT, never from request body for writes.

**API injection:** `withTenantContext(tenantId, fn)` calls `SELECT set_config('app.tenant_id', $1, true)` before running queries.

**DB layer (Phase 4 — substantially complete):**
```sql
SELECT set_config('app.tenant_id', '1001', true);

CREATE POLICY tenant_isolation ON bookings.<table>
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::int);

ALTER TABLE bookings.<table> FORCE ROW LEVEL SECURITY;
```

Missing `app.tenant_id` → zero rows returned (safe failure, no data leak).

**N8N_SERVICE_JWT isolation (fixed June 2026):** The `N8N_SERVICE_JWT` env var has `tenant_id: 1001` hardcoded. Previously used for all n8n → db-api nodes, locking every user to tenant 1001. Now used only for scheduled/cron jobs and server-to-server automation where no user session is in play. All user-facing n8n HTTP Request nodes forward the user's own JWT (extracted from the incoming webhook body or query string).

### Tenant Reference

| Username | tenant_id | Notes |
|---|---|---|
| `admin` | `1` | Super-admin — sees no venue data (intentional) |
| `arj72` | `1001` | Primary venue administrator |
| `sun80` | `1001` | Venue staff |

---

## 12. Configuration & Environment

### 12.1 Frontend Constants

| Constant | Value |
|---|---|
| `DASH_DB_API` / `CAL_DB_API` / `EF_DB_API` | `https://api.venuedesk.co.uk` |
| n8n base | `https://n8n.srv1090894.hstgr.cloud/webhook` |
| FullCalendar | 6.1.10 |
| Font Awesome | 6.4.0 |

### 12.2 db-api Environment Variables

Secrets in `/opt/n8n_postgres/docker-compose.yml` on VPS (not a `.env` file).

| Variable | Description |
|---|---|
| `JWT_SECRET` | HS256 signing key |
| `JWT_EXPIRY` | Default `60m` |
| `DATABASE_URL` | PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Always `.trim()` before use |
| `PASSWORD_PEPPER` | Fallback: `'vp-pepper-change-me'` — must match in both `auth.js` and `onboarding.js` |
| `PORT` | Default `3000` |
| `ONBOARDING_ADMIN_KEY` | Hashed admin key for onboarding portal — used as `X-Admin-Key` header; NOT the plain-text key visible in browser source |
| `CYCLE_SWEEP_SERVICE_JWT` | Long-lived service JWT for scheduled cron jobs (`tenant_id: 1001`, `role: admin`, expiry ~2027); also used as QA test token |
| `N8N_SERVICE_JWT` | Service JWT for n8n automation only — **never** for user-facing HTTP Request nodes |

### 12.3 Deployment Procedures

**Frontend (two-copy rule):**
```bash
# Edit root copy, then sync back to CommunityHub mirror:
cp <file>.html CommunityHub/<file>.html
git add <file>.html CommunityHub/<file>.html
git commit -m "..."
git push origin main
# Test in incognito window after 2–5 min CDN propagation
```

GitHub Pages serves from the **repo root** — `CommunityHub/` is a backup mirror that is not deployed. Commits that only touch `CommunityHub/` will not appear on the live site.

**db-api route — always SCP first, then docker cp:**
```bash
# Step 1 — SCP to VPS host path (REQUIRED — skipping deploys stale code)
scp src/routes/<file>.js root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>.js

# Step 2 — inject into running container + restart
ssh root@72.61.19.52 \
  "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js \
              venuedesk-api:/app/src/routes/<file>.js && \
   docker restart venuedesk-api && sleep 6 && docker logs venuedesk-api --tail 5"

# Step 3 — smoke test (expect 401, not 404)
curl -s -o /dev/null -w "%{http_code}" -X POST https://api.venuedesk.co.uk/<route>
```

**server.js** — SCP lands in `routes/` by mistake; always move first:
```bash
ssh root@72.61.19.52 "mv /opt/n8n_postgres/venuedesk-api/src/routes/server.js \
                           /opt/n8n_postgres/venuedesk-api/src/server.js"
```

**Shell command length:** SCP and SSH commands that exceed ~80 characters wrap in the Claude Code UI, and copy-paste captures the visual newline as a real `\n`, splitting the command into broken fragments. Keep every command under ~80 characters. Use a path variable for long paths:
```bash
S=/opt/n8n_postgres/venuedesk-api/src
docker cp $S/routes/config.js venuedesk-api:/app/src/routes/config.js
```

**n8n workflow:** Deactivate → Delete → Import JSON → Activate. Patch both `nodes` AND `activeVersion.nodes` if editing the JSON directly.

---

## 13. Migration Roadmap

### Phase 1 — Introduce db-api ✅ Complete

Fastify service live at `api.venuedesk.co.uk`. All SQL moved out of n8n into typed route handlers.

### Phase 2 — Move n8n to db-api ✅ Complete (June 2026)

All SQL and business logic moved to db-api. n8n is orchestration-only. Phase 2 violations: 0. Verified via full audit June 25 2026.

Archived 3 defunct n8n workflows (Add Recurring Rule, Recurring Walk-In Booking, Get Outstanding Payments). Fixed N8N_SERVICE_JWT multi-tenant isolation across 10 workflows.

### Phase 3 — JWT Implementation ✅ Complete

- `auth.js` issues JWT with all required claims (`id`, `user_id`, `username`, `role`, `full_name`, `name`, `tenant_id`)
- All pages use `sessionStorage`, body-tunnel pattern, and page-load claim validation (Rule F4)
- `tenant_id` from JWT only for all write operations

### Phase 4 — Row-Level Security ✅ Substantially Complete (June 2026)

RLS enabled and forced on all 12 tenant-scoped tables via migrations 001–028. `withTenantContext` injects tenant context on every transaction. N8N_SERVICE_JWT multi-tenant isolation bug fixed — all user-facing reads now use the user's own JWT.

**Rollback (if needed):**
```sql
ALTER TABLE bookings.<table> DISABLE ROW LEVEL SECURITY;
```

### Phase 5 — Production Hardening (Planned)

- Remove PostgreSQL `ports: - "5432:5432"` from Docker Compose (DB currently exposed on host; protected only by Hostinger cloud firewall)
- JWT refresh tokens (re-login required on 60-min expiry)
- Rate limiting on public endpoints (`/enquiry/create-request`, `/stripe/config`, `/stripe/public-session`)
- CORS origin allowlist (replace `true` with explicit domain list)
- Externalise secrets to Docker secrets or a vault
- Multi-date array feature for `recurring-bookings.html`
- Implement JWT refresh tokens to avoid frequent re-login

### Non-Negotiable Architectural Rules

- No Postgres nodes executing SQL in n8n
- `tenant_id` from JWT only — never request body for writes
- n8n = orchestration only, no business logic
- All writes produce an audit log entry
- Input validation (UUID, required fields, types) on every endpoint
- Tenant injection via `set_config()` — never `SET LOCAL $1`
- SCP before docker cp — never skip the SCP step

---

## 14. Development Rules & Guardrails

### Rule 1 — Variable Declaration Order (Critical)

All API base URL constants at the **top** of every `<script>` block, before any derived `const` that references them in a template literal. A violation kills the entire script block silently.

```javascript
// WRONG — ReferenceError kills entire script silently
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
const DASH_DB_API = 'https://api.venuedesk.co.uk';

// CORRECT
const DASH_DB_API     = 'https://api.venuedesk.co.uk';
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
```

### Rule 2 — JWT Body-Tunnel (No Auth Headers from Browser)

CORS blocks `Authorization` header from browser. JWT in `body.jwt` (POST) or `query.jwt` (GET). n8n HTTP Request nodes and server-to-server calls must use `Authorization: Bearer <jwt>` — no CORS preflight, different rule.

### Rule 3 — Tenant Isolation

GET: `?tenant_id=${_TID()}` — POST: `tenant_id: parseInt(_TID())` in body — API writes: `req.user.tenant_id` only.

### Rule 4 — Identity Priority

```javascript
user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff Manager'
```

`auth.js` must include both `full_name` and `name` alias in every JWT.

### Rule 5 — Stripe Webhook

`req.rawBody` (never re-serialised) + `webhookSecret.trim()`. Never pass `JSON.stringify(req.body)`.

### Rule 6 — SQL Type Safety (42P08)

Never reuse `$N` in two type contexts. Build composite strings in JS, pass as a separate parameter. Every `$N` slot in the values array must be referenced in the SQL with at least one type-providing cast.

### Rule 7 — Settings Subquery Resilience

Always `COALESCE` with hardcoded fallback when reading from `bookings.settings` — missing rows must not throw.

### Rule 8 — Static Site Integrity

No build tools. Vanilla JS only. Existing dark-theme CSS layout must be preserved.

### Rule 9 — GitHub Pages Cache

Test in **incognito window**, 2–5 minutes after push. Normal browser windows serve cached CDN content.

### Rule 10 — Docker Updates

`scp` → `docker cp` → `docker restart`. Do not rely on `docker-compose build` alone. Skipping the SCP step deploys stale code silently.

### Rule 11 — Two-Copy Frontend Deployment

GitHub Pages serves from repo root. Every HTML change must update both `/<file>.html` (live) AND `CommunityHub/<file>.html` (mirror). Never commit only one copy. The two files must remain identical.

### Rule 12 — Single-Line Shell Commands

Never wrap SCP, SSH, or curl commands across multiple display lines. zsh treats the visual newline as a command terminator when copy-pasted from the Claude Code UI, splitting the command into two broken fragments. Keep every command under ~80 characters. Use path variables for long paths.

### Rule 13 — Capacity Guard uses `showToast`, not `alert()`

Browser `alert()` is blocked UX. All validation errors shown via `showToast(message, 'error')`. This applies to the enquiry form, calendar quick-book, and all dashboard modals.

### Rule 14 — Partition Order uses `?? null` not `|| null`

`0` is a valid `partition_order` value (1st partition). `0 || null` evaluates to `null`. Always use nullish coalescing:
```javascript
partition_order: payload.partition_order ?? null   // CORRECT
partition_order: payload.partition_order || null   // WRONG — 0 → null
```

### Rule 15 — N8N_SERVICE_JWT is for Automation Only

Never use `N8N_SERVICE_JWT` as auth for user-facing n8n HTTP Request nodes. It has `tenant_id: 1001` hardcoded and locks RLS context to that tenant for all users. User-facing nodes must forward the user's own JWT:

```javascript
// POST webhook — user sent jwt in body
Authorization: ={{ 'Bearer ' + ($('Webhook: Dashboard').first().json.body?.jwt || $env.N8N_SERVICE_JWT) }}

// GET webhook — frontend appended &jwt=<token> to query string
Authorization: ={{ 'Bearer ' + ($json.query?.jwt || $env.N8N_SERVICE_JWT) }}
```

Permitted uses of `N8N_SERVICE_JWT`: scheduled/cron jobs, `POST /admin/audit-log` fan-out, `POST /health/pulse`, and other server-to-server operations not scoped to a specific user.

### Rule 16 — Always Check `res.ok` Before Success Toast

`fetch()` does not throw on 4xx/5xx responses. Every mutating fetch call must check `res.ok` before declaring success:

```javascript
const res = await fetch(API.deleteRoom, { method: 'POST', ... });
if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || e.message || 'Operation failed');
}
showToast('Done');
```

### Rule 17 — Frontend ID Generation uses `crypto.randomUUID()`

Never generate IDs with `'prefix_' + Date.now()` — these fail `assertUUID` validation at db-api and are silently swallowed by `.catch(() => {})`. Always use `crypto.randomUUID()` for any ID that will be sent to db-api.

### Rule 18 — n8n X-Admin-Key Header uses Server Env Var Only

All n8n HTTP Request nodes calling `/onboarding/*` endpoints must use `$env.ONBOARDING_ADMIN_KEY` — never the frontend plain-text key from the request body. The frontend key and the server env var value are different; the frontend value shadows the env var and causes 401.

---

*Document updated from live codebase and session audit. Last updated: July 2026 — Version 3.0.*
