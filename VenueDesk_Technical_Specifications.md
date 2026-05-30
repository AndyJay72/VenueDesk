# VenueDesk — Technical Specifications

**Version:** 2.0  
**Date:** May 2026  
**Status:** Active Development — Phases 1–3 Complete, Phase 4 (RLS) In Progress

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Frontend](#3-frontend)
4. [Backend — db-api (Fastify)](#4-backend--db-api-fastify)
5. [Backend — n8n Workflows (Legacy / Recurring)](#5-backend--n8n-workflows-legacy--recurring)
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

## 1. System Overview

VenueDesk is a multi-tenant venue booking and CRM platform for community halls, sports centres, and event spaces. It manages:

- Single and recurring room bookings
- Customer records and interaction history
- Recurring contract management with parent-child session architecture
- Automated payment chasing and billing cycles
- Staff user management and audit logging
- Lead generation and enquiry capture
- Stripe-powered online payments (card + BACS)

As of May 2026, the platform has completed the migration from a direct-database n8n architecture to a secure db-api layer. JWT authentication is now issued and verified exclusively by `venuedesk-api` (Fastify). PostgreSQL Row-Level Security is enabled on key tables. n8n is retained for recurring booking orchestration and legacy automation workflows only — it no longer executes raw SQL for the core booking/payment/auth paths.

---

## 2. Architecture

### 2.1 Current Architecture (Post Phase 1–3 Migration)

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
    (bookings schema — RLS enforced on core tables)        │
                                                            │
  n8n Webhooks  ◄─────────────────────────────────────────
  (Orchestration only — recurring bookings, automation)
  https://n8n.srv1090894.hstgr.cloud/webhook
         │
         ▼
    PostgreSQL (legacy recurring workflows — migration pending)
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
| Config / rooms | db-api |
| Blocked dates | db-api |
| Recurring series creation | n8n (legacy — migration pending) |
| Payment chasing automation | n8n (scheduled) |

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
| Orchestration (legacy) | n8n (self-hosted, webhook-driven) |
| Database | PostgreSQL 15 (`bookings` schema) |
| Auth | JWT HS256, signed by `venuedesk-api` |
| Payments | Stripe Checkout (card) + BACS |
| Hosting — frontend | GitHub Pages (static) |
| Hosting — API + DB | VPS (Docker Compose — Traefik proxy) |
| Fonts / Icons | Plus Jakarta Sans (Google Fonts), Font Awesome 6 |

---

## 3. Frontend

### 3.1 Architecture — Static HTML (Not SPA)

The frontend is **static HTML/CSS/JS** served via GitHub Pages. There is no build step, no bundler, no SPA framework. All pages are standalone `.html` files in `CommunityHub/`. Each page manages its own state and API calls via embedded `<script>` blocks and vanilla JavaScript.

**Do not introduce Vite, Webpack, React, Vue, or any build tooling.** All fixes and features must be vanilla JS edits to existing `.html` files.

```
CommunityHub/
├── index.html                 Main dashboard (KPIs, bookings, payments)
├── login.html                 Auth page → POST /auth/login on db-api
├── calendar.html              FullCalendar day/week/month view
├── accounts.html              Financial overview
├── users.html                 Staff user management (list, create, edit, delete)
├── admin-config.html          Venue settings, rooms, Stripe config
├── enquiry-form.html          Public enquiry capture → db-api /enquiry/create-request
├── checkout.html              Stripe payment return URL handler
├── recurring-bookings.html    Recurring contract creation (1,200+ lines)
├── manual-booking.html        Single booking form
├── leadgen-dashboard.html     Lead generation dashboard
└── tenants.json               Multi-tenant configuration
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

All pages read from `sessionStorage` (not `localStorage`). Login must set all keys on successful authentication.

| Key | Value | Used for |
|---|---|---|
| `vp_token` | JWT string | Body-tunnel in all POST requests, query param in GET |
| `vp_tenant_id` | Numeric string (e.g., `"1001"`) | Tenant isolation on all queries |
| `vp_user_name` | User display name | `staff_member` field on interactions |
| `vp_venue_name` | Venue display name | Sidebar display |
| `vp_user` | `JSON.stringify(user)` | Full user context object |

### 3.4 Auth Pattern (CORS Constraint — Body Tunnel)

The db-api CORS config allows only `Content-Type` in `allowedHeaders`. Sending an `Authorization: Bearer` header triggers a CORS preflight that the browser blocks. **Never add `Authorization` to frontend `fetch` calls.**

JWT travels via the request body for POST calls and the query string for GET calls:

```javascript
// Helper functions used across all pages
function getAuthHeaders() { return {}; }           // always empty — no auth headers
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

### 3.6 Identity Resolution

Always resolve display names in this priority order:

```javascript
const name = user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff Manager';
```

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

**Deferred feature:** Multi-date array drag-select / specific-date mode extension — scheduled for next development session.

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

---

## 4. Backend — db-api (Fastify)

### 4.1 Overview

`venuedesk-api` is a Node.js / Fastify service that owns all authenticated database access, JWT issuance, and Stripe integration. It runs in a Docker container on the VPS behind Traefik.

**Source:** `venue_desk_backup/venuedesk-api/src/`

```
venuedesk-api/src/
├── server.js                  Entry point — plugins, routes, boot
├── db/
│   ├── pool.js                pg Pool instance
│   ├── migrate.js             Auto-migration runner on boot
│   ├── migrations/            Numbered .sql files (001–017+)
│   └── withTenantContext.js   Transaction wrapper — sets RLS tenant context
├── middleware/
│   └── errorHandler.js        Global Fastify error handler
└── routes/
    ├── auth.js                POST /auth/login — issues JWT
    ├── dashboard.js           GET  /dashboard/* — KPIs, bookings, revenue
    ├── bookings.js            Booking lifecycle endpoints
    ├── payments.js            Payment read endpoints
    ├── payments-manual.js     POST /payments/pay — atomic balance settlement
    ├── customers.js           Customer CRUD
    ├── accounts.js            Financial overview
    ├── recurring.js           Recurring series + payments
    ├── leads.js               Lead generation
    ├── users.js               GET /users — staff list
    ├── users-update.js        POST /users/update — staff write ops
    ├── admin.js               Venue settings, payment config
    ├── config.js              Room/event-type config
    ├── onboarding.js          Venue setup wizard
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

**CORS** — `allowedHeaders: ['Content-Type']` only. `Authorization` excluded intentionally — JWT travels via body/query.

**JWT** — `@fastify/jwt`, HS256, expiry from `JWT_EXPIRY` env var (default `60m`).

**`fastify.authenticate` decorator** — tries `Authorization` header first (n8n/Postman), falls back to `body.jwt` / `query.jwt`. Validates `user_id || id` and `tenant_id`; rejects with 401 if either missing.

### 4.3 `withTenantContext` Pattern

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

`set_config(..., true)` scopes the setting to the current transaction (= `SET LOCAL`). **Never use `SET LOCAL $1`** — PostgreSQL does not accept parameterised SET commands (error `42601`).

`tenant_id` for write operations always comes from `req.user.tenant_id` (JWT claim) — never from the request body.

### 4.4 Password Hashing

```
hash = SHA512('vp-pepper-change-me' + plaintext_password)  →  128-char hex string
```

Pepper is baked in (not from env var) to maintain compatibility with the original n8n Crypto node hashes. **Do not change the pepper** — it invalidates all existing passwords.

### 4.5 Migrations

Files `001_*.sql` through `017_*.sql` run automatically at container start.

| Migration | Description |
|---|---|
| `001–015` | Core schema — all tables, indexes, triggers |
| `016_tenants_rls_policy.sql` | RLS policy on `bookings.tenants` |
| `017_booking_requests_enquiry_fields.sql` | `hire_type`, `total_cost`, `event_type`, `notes` + UNIQUE `(email, tenant_id)` |

---

## 5. Backend — n8n Workflows (Legacy / Recurring)

### 5.1 Current Role

n8n is **orchestration-only**. The core auth/booking/payment/user paths have migrated to db-api. n8n retains:

- Recurring booking series creation and management
- Scheduled payment chasing automation
- Email notifications
- Legacy read/reporting endpoints not yet migrated

**Base webhook URL:** `https://n8n.srv1090894.hstgr.cloud/webhook`

### 5.2 Active Workflow Index

| File | Workflow Name | Key Paths |
|---|---|---|
| `hBclMCxbgmz7f3Za.json` | Complete System API | `staff-dashboard`, `all-customers`, `accounts-data`, `get-pending-requests`, `update-status`, `cancel-pending`, `get-monthly-revenue` |
| `7ZXOI73BhHLXkyOc.json` | Confirm Booking | `confirm-booking` |
| `AGkUe3zjjFDD0wOL.json` | Cancellation Manager | `cancel-booking` |
| `KHvxUBua7hi5e1x1.json` | Financial Operations | `pay-balance` (superseded by db-api `/payments/pay`) |
| `nW4p6cg3l7OHwjQP.json` | Customer Interactions | `customer-interactions` |
| `baGN4RUcgtsDTISA.json` | Config Manager | `get-rooms`, `create-room`, `update-room`, etc. |
| `3JqHCjua5lKZGpeB.json` | Blocked Dates API | `blocked-dates` |
| `kB5xoIh4gcaRsCpW.json` | Create Customer (Upsert) | `create-customer` |
| `eI6PSBE1TbpaRx9K.json` | Make Booking | `make-booking`, `check-availability` |
| `UpdateCustomerWF.json` | Update Customer | `update-customer` |
| `ServicesWF.json` | Services API | `get-service-data`, `save-service`, `delete-service` |

### 5.3 Recurring Booking Workflow Structure

```
Webhook
  → Code: Parse + Validate
  → DB: Check Clashes        (overlap query)
  → Code: Filter Dates       (remove clashing/blocked)
  → DB: Upsert Customer
  → DB: Insert Series        (parent record)
  → DB: Insert Bookings      (bulk INSERT — NOT EXISTS guard)
  → DB: Insert Payment Schedule
  → Respond: Created / Not Available
```

### 5.4 Clash Detection SQL

```sql
SELECT COALESCE(ARRAY_AGG(d::text ORDER BY d), ARRAY[]::text[]) AS clashed_dates
FROM unnest(string_to_array($1, ',')) AS d
WHERE $1 <> ''
  AND (
    EXISTS (
      SELECT 1 FROM bookings.confirmed_bookings cb
      WHERE cb.room_id   = NULLIF($2, '')::uuid
        AND cb.tenant_id = $3::integer
        AND cb.status NOT IN ('cancelled')
        AND d::date BETWEEN COALESCE(cb.date_from::date, cb.booking_date)
                        AND COALESCE(cb.date_to::date,   cb.booking_date)
        AND cb.start_time < $5::time
        AND cb.end_time   > $4::time
    )
    OR EXISTS (
      SELECT 1 FROM bookings.blocked_dates bd
      WHERE bd.tenant_id = $3::integer
        AND (
          (bd.block_type = 'oneoff'            AND bd.block_date::date = d::date)
          OR (bd.block_type IN ('recurring', 'recurring-weekday')
                                               AND bd.day_of_week = EXTRACT(DOW FROM d::date)::int)
          OR (bd.block_type = 'range'          AND d::date BETWEEN bd.date_from::date AND bd.date_to::date)
        )
    )
  )
```

Parameters: `$1` = comma-separated dates, `$2` = room_id, `$3` = tenant_id, `$4` = start_time, `$5` = end_time.

### 5.5 Duplicate Guard on Bulk INSERT

```sql
INSERT INTO bookings.confirmed_bookings (...)
SELECT $1, $2::uuid, $3::uuid, d::date, ...
FROM unnest(string_to_array($4, ',')) AS t(d)
WHERE $4 <> ''
  AND NOT EXISTS (
    SELECT 1 FROM bookings.confirmed_bookings ex
    WHERE ex.room_id    = $3::uuid
      AND ex.tenant_id  = $1::integer
      AND ex.status NOT IN ('cancelled')
      AND ex.booking_date = d::date
      AND ex.start_time   < $6::time
      AND ex.end_time     > $5::time
  )
RETURNING booking_date::text, id;
```

---

## 6. Database Schema

### 6.1 Schema Overview

All tables in the `bookings` schema. Every table has `tenant_id INT NOT NULL`. RLS active on `bookings.tenants` (migration 016). Full FORCE RLS rollout is Phase 4.

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
| hire_type | TEXT | `half_day` \| `full_day` \| `hourly` |
| total_cost | NUMERIC | |
| event_type | TEXT | |
| notes | TEXT | |
| status | TEXT | `pending_review` \| `deposit_paid` \| `booked` \| `cancelled` |

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
| payment_status | TEXT | `pending` \| `paid` \| `overdue` \| `cancelled` |
| status | TEXT | `confirmed` \| `provisional` \| `cancelled` \| `pending` |
| is_recurring | BOOLEAN | |
| recurring_series_id | UUID | FK → recurring_series (NULL for standalone) |
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
| payment_type | TEXT | `deposit` \| `balance` |
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
| payment_timing | TEXT | `in_advance` \| `in_arrears` |
| billing_type | TEXT | `monthly` \| `per_session` \| `upfront` |
| active | BOOLEAN | |
| notes | TEXT | |

#### `bookings.rooms`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| name | TEXT | |
| capacity | INT | |
| day_rate | NUMERIC | |
| rate_per_hour | NUMERIC | |
| available_from | TIME | |
| available_to | TIME | |
| is_active | BOOLEAN | |

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

#### `bookings.audit_logs`

All write operations log here. Columns: `tenant_id`, `action` (CREATE/UPDATE/CANCEL), `entity`, `entity_id`, `payload` (JSONB), `performed_by`, `created_at`.

### 6.3 Key Indexes

```sql
CREATE INDEX idx_confirmed_bookings_tenant    ON bookings.confirmed_bookings(tenant_id);
CREATE INDEX idx_confirmed_bookings_room_date ON bookings.confirmed_bookings(room_id, booking_date);
CREATE INDEX idx_confirmed_bookings_series    ON bookings.confirmed_bookings(recurring_series_id);
CREATE INDEX idx_recurring_series_tenant      ON bookings.recurring_series(tenant_id, active);
CREATE INDEX idx_customers_tenant             ON bookings.customers(tenant_id);
CREATE INDEX idx_booking_requests_tenant      ON bookings.booking_requests(tenant_id);
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
| POST | `/bookings/create` | JWT | Create single booking |
| POST | `/bookings/confirm` | JWT | Confirm a pending booking |
| POST | `/bookings/cancel` | JWT | Cancel with refund calculation |
| GET | `/bookings/calendar` | JWT | All events for FullCalendar |

#### Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/pay` | JWT | Atomic settlement — INSERT payment + UPDATE booking in one transaction |
| GET | `/payments/outstanding` | JWT | Outstanding payment summary |

#### Enquiry (Public)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/enquiry/create-request` | Public | Upsert customer + insert booking_requests row. Returns `booking_request_id` |

#### Customers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/customers` | JWT | Paginated customer list |
| POST | `/customers/update` | JWT | Update customer fields |
| GET | `/customers/:id` | JWT | Single customer |

#### Staff Users

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | JWT | Staff list for tenant |
| POST | `/users/create` | JWT | Create staff user (SHA512+PEPPER hash) |
| POST | `/users/update` | JWT | Update name, role, optional password |
| POST | `/users/delete` | JWT | Remove staff user |

#### Config & Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/config/rooms` | JWT | Room list |
| POST | `/config/rooms/create` | JWT | Add room |
| POST | `/config/rooms/update` | JWT | Modify room |
| GET | `/admin/payment-settings` | JWT | Stripe config for tenant |
| POST | `/admin/payment-settings` | JWT | Save Stripe keys |

#### Recurring

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/recurring` | JWT | Active recurring series |
| POST | `/recurring/pay` | JWT | Record payment on series parent |
| POST | `/recurring/cancel` | JWT | Cancel series + all children |

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

#### Stripe

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/stripe/config` | Public | `is_stripe_enabled`, `stripe_publishable_key` |
| GET | `/stripe/bacs-details` | JWT (query) | BACS account details |
| POST | `/stripe/session` | JWT | Create Checkout session (dashboard) |
| POST | `/stripe/public-session` | Public | Create Checkout session (enquiry — £10–£500) |
| POST | `/stripe/webhook` | Stripe sig | Payment confirmation |

#### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | `{ status: "ok", ts: "..." }` |

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

### 7.3 n8n Webhook Endpoints (Legacy — Pending Migration)

Base: `https://n8n.srv1090894.hstgr.cloud/webhook`

| Path | Method | Description |
|---|---|---|
| `confirm-booking` | POST | Confirm pending request |
| `cancel-booking` | POST | Cancel with refund calc |
| `create-customer` | POST | Legacy customer upsert |
| `update-customer` | POST | Legacy customer update |
| `create-recurring-booking` | POST | Recurring series creation |
| `check-recurring-clashes` | POST | Pre-flight availability |
| `get-recurring-bookings` | GET | Active series list |
| `customer-interactions` | GET | Activity log |
| `accounts-data` | GET | Accounts overview |
| `get-monthly-revenue` | GET | Revenue trend |

### 7.4 Standard Response Shapes

```json
// Successful booking
{ "status": "created", "booking_count": 24, "series_id": "uuid", "partial_booking": false }

// Partial booking (some dates clashed)
{ "status": "created", "booking_count": 16, "partial_booking": true,
  "warning": "Series cut short — 2026-06-09 is already booked.", "first_conflict_date": "2026-06-09" }

// Not available
{ "status": "not_available", "message": "The first session date is already booked." }
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
| RLS | `set_config('app.tenant_id', ...)` in every transaction |
| Password hashing | SHA512 + PEPPER — 128-char hex |
| Token expiry | 60 minutes (`JWT_EXPIRY` env var) |
| Rate limiting | **Pending Phase 5** |
| Token refresh | **Pending Phase 5** — re-login on expiry |
| Postgres host port | **Pending Phase 5** — `5432:5432` exposes DB; remove `ports:` block in production |

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
  → Return URL → checkout.html?session_id=<id>
  → POST /stripe/webhook       (signature verified)
  → UPDATE confirmed_bookings.balance_due + status
```

### 9.2 Enquiry Form Deposit

```
POST /enquiry/create-request   →  { booking_request_id, customer_id }
POST /stripe/public-session    →  Checkout URL (includes booking_request_id)
Stripe webhook                 →  booking_requests.status = 'deposit_paid'
```

`booking_request_id` must be captured before creating the Stripe session — the webhook uses it to link the payment to the correct request.

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
```

---

## 10. Booking Logic & Data Flows

### 10.1 Single Booking (db-api)

```
POST /bookings/create → withTenantContext transaction:
  1. Validate input
  2. Check availability (start < req.end AND end > req.start)
  3. Upsert customer by email
  4. INSERT confirmed_bookings
  5. INSERT payments (if deposit)
  6. INSERT audit_logs
  HTTP 200 only after COMMIT
```

### 10.2 Recurring Booking (n8n — pending migration)

Parent-child architecture: one `recurring_series` row holds all debt; N `confirmed_bookings` children have `balance_due = 0`.

```
1. Frontend: generate candidate dates, filter blocked_dates client-side
2. POST /check-recurring-clashes → clashed_dates[]
3. Clash modal if needed (proceed with safe dates or cancel)
4. POST create-recurring-booking:
   - Re-check clashes server-side
   - INSERT recurring_series (1 parent)
   - Bulk INSERT confirmed_bookings (NOT EXISTS guard)
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

### 10.4 Payment Chasing (n8n — scheduled)

```
BillingCycleTrigger (daily)
  1–30 days overdue  → reminder email
  30–60 days overdue → escalation email
  60+ days overdue   → auto-cancel: series.active = false, children status = 'cancelled'
```

---

## 11. Multi-Tenancy

Every table has `tenant_id INT NOT NULL`. Two layers enforce isolation:

**JWT layer:** `tenant_id` from verified JWT, injected via `withTenantContext`.

**DB layer (Phase 4):**
```sql
SELECT set_config('app.tenant_id', '1001', true);

CREATE POLICY tenant_isolation ON bookings.<table>
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::int);

ALTER TABLE bookings.<table> FORCE ROW LEVEL SECURITY;
```

Missing `app.tenant_id` → zero rows returned (safe failure, no data leak).

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
| n8n base (legacy) | `https://n8n.srv1090894.hstgr.cloud/webhook` |
| FullCalendar | 6.1.10 |
| Font Awesome | 6.4.0 |

### 12.2 db-api Environment Variables

Secrets in `/opt/n8n_postgres/docker-compose.yml` on VPS.

| Variable | Description |
|---|---|
| `JWT_SECRET` | HS256 signing key |
| `JWT_EXPIRY` | Default `60m` |
| `DATABASE_URL` | PostgreSQL connection string |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Always `.trim()` before use |
| `PASSWORD_PEPPER` | Fallback: `'vp-pepper-change-me'` |
| `PORT` | Default `3000` |

### 12.3 Deployment Procedures

**Frontend:**
```bash
git add CommunityHub/<file>.html && git commit -m "..." && git push origin main
# Test in incognito window after 2–5 min CDN propagation
```

**db-api route:**
```bash
scp <file> root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>
ssh root@72.61.19.52 "docker cp /opt/.../routes/<file> venuedesk-api:/app/src/routes/<file> && docker restart venuedesk-api"
curl -s -o /dev/null -w "%{http_code}" -X POST https://api.venuedesk.co.uk/<route>  # expect 401
```

**server.js** — SCP lands in `routes/`; always `mv` first:
```bash
ssh root@72.61.19.52 "mv /opt/.../routes/server.js /opt/.../src/server.js"
```

**n8n workflow:** Deactivate → Delete → Import JSON → Activate. Patch both `nodes` AND `activeVersion.nodes`.

---

## 13. Migration Roadmap

### Phase 1 — Introduce db-api ✅ Complete

Fastify service live at `api.venuedesk.co.uk`. All SQL moved out of n8n into typed route handlers.

### Phase 2 — Move n8n to db-api ✅ Substantially Complete

Migrated: auth, bookings, payments, enquiry, users, customers, blocked dates, Stripe, admin config.
**Remaining:** recurring booking creation, payment chasing automation.

### Phase 3 — JWT Implementation ✅ Complete

- `auth.js` issues JWT with all required claims
- All pages use `sessionStorage`, body-tunnel pattern, page-load claim validation
- `tenant_id` from JWT only for all write operations

### Phase 4 — Row-Level Security 🔄 In Progress

RLS active on `bookings.tenants`. `withTenantContext` injects tenant context on every transaction.

**Remaining rollout order:**
`customers` → `confirmed_bookings` → `booking_requests` → `recurring_series` → `payments` → `audit_logs` → `rooms` → `blocked_dates`

Per table: `ENABLE` → add policy → test → `FORCE`.
Rollback: `ALTER TABLE bookings.<table> DISABLE ROW LEVEL SECURITY;`

### Phase 5 — Production Hardening (Planned)

- Remove PostgreSQL `ports: - "5432:5432"` from Docker Compose
- JWT refresh tokens
- Rate limiting on public endpoints
- CORS origin allowlist (replace `true` with explicit domain list)
- Externalise secrets to Docker secrets / vault
- Multi-date array feature for `recurring-bookings.html`

### Non-Negotiable Architectural Rules

- No Postgres nodes executing SQL in n8n
- `tenant_id` from JWT only — never request body for writes
- n8n = orchestration only, no business logic
- All writes produce an audit log entry
- Input validation (UUID, required fields, types) on every endpoint
- Tenant injection via `set_config()` — never `SET LOCAL $1`

---

## 14. Development Rules & Guardrails

### Rule 1 — Variable Declaration Order (Critical)

All API base URL constants at the **top** of every `<script>` block before any derived `const`.

```javascript
// WRONG — ReferenceError kills entire script silently
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
const DASH_DB_API = 'https://api.venuedesk.co.uk';

// CORRECT
const DASH_DB_API     = 'https://api.venuedesk.co.uk';
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
```

### Rule 2 — JWT Body-Tunnel (No Auth Headers)

CORS blocks `Authorization` header from browser. JWT in `body.jwt` (POST) or `query.jwt` (GET).

### Rule 3 — Tenant Isolation

GET: `?tenant_id=${_TID()}` — POST: `tenant_id: parseInt(_TID())` in body — API writes: `req.user.tenant_id` only.

### Rule 4 — Identity Priority

```javascript
user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff Manager'
```

`auth.js` must include both `full_name` and `name` alias in every JWT.

### Rule 5 — Stripe Webhook

`req.rawBody` (never re-serialised) + `webhookSecret.trim()`.

### Rule 6 — SQL Type Safety (42P08)

Never reuse `$N` in two type contexts. Build composite strings in JS, pass as a separate parameter.

### Rule 7 — Settings Subquery Resilience

Always `COALESCE` with hardcoded fallback when reading from `bookings.settings` — missing rows must not throw.

### Rule 8 — Static Site Integrity

No build tools. Vanilla JS only. Existing dark-theme CSS layout must be preserved.

### Rule 9 — GitHub Pages Cache

Test in **incognito window**, 2–5 minutes after push.

### Rule 10 — Docker Updates

`scp` → `docker cp` → `docker restart`. Do not rely on `docker-compose build` alone.

---

*Document updated from live codebase and session audit. Last updated: May 2026 — Version 2.0.*
