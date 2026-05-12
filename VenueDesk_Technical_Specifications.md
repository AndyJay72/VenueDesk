# VenueDesk — Technical Specifications

**Version:** 1.0  
**Date:** April 2026  
**Status:** Active Development (Pre-Production)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Frontend](#3-frontend)
4. [Backend — n8n Workflows](#4-backend--n8n-workflows)
5. [Database Schema](#5-database-schema)
6. [API Endpoints](#6-api-endpoints)
7. [Authentication & Security](#7-authentication--security)
8. [Booking Logic & Data Flows](#8-booking-logic--data-flows)
9. [Multi-Tenancy](#9-multi-tenancy)
10. [Configuration & Environment](#10-configuration--environment)
11. [Migration Roadmap](#11-migration-roadmap)

---

## 1. System Overview

VenueDesk is a multi-tenant venue booking and CRM platform built for community halls, sports centres, and event spaces. It manages:

- Single and recurring room bookings
- Customer records and interaction history
- Recurring contract management with parent-child session architecture
- Automated payment chasing and billing cycles
- Staff user management and audit logging
- Lead generation and enquiry capture

The platform is currently in a transition phase, moving from a direct database / n8n architecture towards a secure db-api layer with JWT authentication and PostgreSQL Row-Level Security (RLS).

---

## 2. Architecture

### 2.1 Current Architecture

```
Client (Browser)
      │ HTTP / JSON
      ▼
n8n Webhooks
(Orchestration + SQL execution)
      │ pg / SQL
      ▼
PostgreSQL
(bookings schema)
```

Requests flow from the browser directly to n8n webhook endpoints. n8n workflows handle both business logic and raw SQL execution. Tenant isolation is applied at the application level by including `tenant_id` in request bodies.

### 2.2 Target Architecture (Post-Migration)

```
Client / n8n
      │ JWT (Authorization: Bearer)
      ▼
db-api (Node.js / Fastify)
(Auth + Validation + Audit logging)
      │ SET LOCAL app.tenant_id = <from JWT>
      ▼
PostgreSQL
(RLS enforced — bookings schema)
      │
      ▼
n8n
(Orchestration only — no SQL)
      │
      ▼
AI Agents
```

### 2.3 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript, FullCalendar 6, HTML5/CSS3 |
| Orchestration | n8n (self-hosted, webhook-driven) |
| Database | PostgreSQL (bookings schema) |
| Auth | JWT (HS256 / RS256), Bearer tokens |
| Hosting (n8n) | `https://n8n.srv1090894.hstgr.cloud` |
| Fonts / Icons | Plus Jakarta Sans (Google Fonts), Font Awesome 6 |

---

## 3. Frontend

### 3.1 Application Structure

```
CommunityHub/
├── spa/                          Single Page Application (current)
│   ├── index.html                Entry point / shell
│   ├── login.html                Auth page
│   ├── js/
│   │   ├── app.js                Bootstrap / init
│   │   ├── auth.js               JWT handling, session management
│   │   ├── api.js                HTTP client wrapper (50+ methods)
│   │   ├── router.js             Hash-based SPA router
│   │   ├── ui.js                 Shared UI utilities
│   │   └── pages/                15 page modules (dynamic imports)
│   └── css/                      Theme + shared styles
├── recurring-bookings.html       Dedicated recurring booking interface
├── manual-booking.html           Single booking form
├── venuepro_booking.html         VenuePro booking flow
├── enquiry-form.html             Public enquiry capture
├── calendar.html                 FullCalendar day/week/month view
├── tenants.json                  Multi-tenant configuration
├── event-types-data.json         Event category list
└── rooms-data.json               Room catalogue
```

### 3.2 SPA Routing

Routes are hash-based (`#/path`) and map to dynamically imported page modules:

| Route | Module | Description |
|---|---|---|
| `#/` | dashboard.js | KPIs, pending requests, outstanding payments |
| `#/bookings` | bookings.js | Booking list with filters and payment modal |
| `#/calendar` | calendar.js | FullCalendar integration |
| `#/customers` | customers.js | Customer CRUD and interaction history |
| `#/manual-booking` | manual-booking.js | Create single bookings |
| `#/final-payment` | final-payment.js | Payment processing |
| `#/accounts` | accounts.js | Financial overview, invoice history |
| `#/audit-log` | audit-log.js | Activity log, customer interactions |
| `#/users` | users.js | Staff user management |
| `#/admin-config` | admin-config.js | Venue settings, rooms, event types |
| `#/leadgen` | leadgen.js | Lead generation dashboard |
| `#/onboarding` | onboarding.js | Venue setup wizard |
| `#/enquiry` | enquiry-form.js | Enquiry submission form |

### 3.3 Core JavaScript Modules

**auth.js**
Handles all session management. Key methods:
- `Auth.getToken()` — Retrieves JWT from `localStorage['vp_token']`
- `Auth.getTenantId()` — Gets tenant ID from `localStorage['vp_tenant_id']`
- `Auth.headers()` — Builds request headers with Bearer token
- `Auth.requireAuth()` — Guards page access, redirects to login if expired

**api.js**
Thin HTTP client wrapping all n8n webhook calls. Appends auth headers on every request and exposes typed methods for each endpoint (e.g., `api.createBooking()`, `api.getCustomers()`).

**router.js**
Hash-based SPA router. Dynamically imports page modules on navigation and tears down the previous page.

### 3.4 Recurring Bookings Interface (`recurring-bookings.html`)

A standalone 1,200+ line page with its own embedded state machine for recurring contract creation. Key features:

- Day-of-week selector grid (Sun–Sat checkboxes, each with independent start/end times)
- Specific-dates mode (click to pick individual dates from mini monthly calendars)
- Real-time cost preview (cycle price, total contract value)
- Pre-flight availability check before submission (calls `check-recurring-clashes` webhook)
- Clash modal: shows blocked/conflicting dates with option to proceed with available sessions or cancel
- Payment summary sidebar

**Key client-side functions:**

| Function | Purpose |
|---|---|
| `qbSubmitRecurringBooking(type)` | Orchestrates full pre-flight + submission flow |
| `qbIsDateBlocked(dateStr)` | Checks date against blocked_dates rules (oneoff / recurring / recurring-weekday / range) |
| `qbDoSubmitRecurring(payload, btns)` | POSTs to Create Recurring webhook, handles partial_booking response |
| `qbProceedWithSafeDates()` | User confirms modal — triggers submission with conflict-free dates |
| `qbCloseClashModal()` | Cancels and re-enables booking buttons |
| `qbUpdateRecurrencePreview()` | Refreshes date list and cost preview in real time |

### 3.5 Design System

CSS custom properties used across all pages:

```css
--bg-dark:    #0f172a        /* Page background */
--bg-card:    rgba(30,41,59,0.7)  /* Card surfaces */
--border:     rgba(148,163,184,0.1)
--primary:    #6366f1        /* Indigo — primary actions */
--success:    #10b981        /* Emerald */
--warning:    #f59e0b        /* Amber */
--danger:     #ef4444        /* Red */
--text-main:  #f8fafc        /* Slate-50 */
--text-muted: #94a3b8        /* Slate-400 */
--sidebar-width: 260px
```

---

## 4. Backend — n8n Workflows

### 4.1 Overview

All business logic and database access currently lives inside n8n workflows, triggered via HTTP webhooks. There are 80+ workflow files covering booking management, payment chasing, reporting, and administration.

**Base webhook URL:** `https://n8n.srv1090894.hstgr.cloud/webhook`

### 4.2 Workflow Categories

**Booking Management**

| Workflow | ID | Description |
|---|---|---|
| CreateRecurringBooking | — | Creates parent series + child sessions |
| CreateRecurringFromCalendar | y1zkERdFOULI8aUY | Quick-book from calendar drag |
| CreateRecurringBookingFixed | bkD0FkR1MtXvcm59 | Alternate recurring creation path |
| CheckRecurringClashes | WNEiyn2bRdoBK20U | Pre-flight conflict detection |
| RecurringMakeBooking | — | Generate individual sessions from series |
| RecurringWalkInBooking | — | Walk-in session creation |
| CancelBooking | — | Single booking cancellation with refund |
| CancelRecurringSeries | — | Cancel entire series + all children |

**Payment Processing**

| Workflow | Description |
|---|---|
| RecordRecurringPayment | Log payment against recurring series parent |
| RecurringPaymentChaser | Automated payment reminder emails |
| RecurringPaymentReminder | Advance payment notices |
| RecurringAutoCancel | Auto-cancel non-paying series (60+ days overdue) |
| RecurringPaymentOverride | Manual payment override |
| BillingCycleTrigger | Scheduled monthly billing trigger |

**Customer & Reporting**

| Workflow | Description |
|---|---|
| UpdateCustomerWF | Customer record updates |
| GetRecurringBookings | Fetch active recurring series |
| GetRepeatClients | Identify repeat customers |
| GetOutstandingPayments | Billing dashboard query |
| CustomerInteractions | Activity log entries |

### 4.3 Typical Workflow Node Structure

A standard Create/Update workflow follows this node pattern:

```
Webhook (trigger)
  → Code: Parse Input        (extract + sanitise request body)
  → Code: Validate           (check required fields, types, UUIDs)
  → DB: Check Clashes        (PostgreSQL — availability query)
  → Code: Filter Dates       (remove clashing/blocked dates, build response metadata)
  → DB: Upsert Customer      (INSERT ... ON CONFLICT DO UPDATE)
  → DB: Insert Series        (parent record)
  → DB: Insert Bookings      (bulk INSERT child sessions)
  → DB: Insert Payment Schedule
  → Respond: Created         (JSON response)
  → Respond: Not Available   (if fully blocked)
```

### 4.4 Clash Detection SQL

The canonical overlap detection query used across all recurring booking workflows:

```sql
SELECT COALESCE(
  ARRAY_AGG(d::text ORDER BY d),
  ARRAY[]::text[]
) AS clashed_dates
FROM unnest(string_to_array($1, ',')) AS d
WHERE $1 <> ''
  AND (
    EXISTS (
      SELECT 1 FROM bookings.confirmed_bookings cb
      WHERE cb.room_id    = NULLIF($2, '')::uuid
        AND cb.tenant_id  = $3::integer
        AND cb.status NOT IN ('cancelled')
        AND d::date BETWEEN COALESCE(cb.date_from::date, cb.booking_date)
                        AND COALESCE(cb.date_to::date,   cb.booking_date)
        AND cb.start_time < $5::time   -- correct interval overlap
        AND cb.end_time   > $4::time
    )
    OR EXISTS (
      SELECT 1 FROM bookings.blocked_dates bd
      WHERE bd.tenant_id = $3::integer
        AND (
          (bd.block_type = 'oneoff'
            AND bd.block_date::date = d::date)
          OR (bd.block_type IN ('recurring', 'recurring-weekday')
            AND bd.day_of_week = EXTRACT(DOW FROM d::date)::int)
          OR (bd.block_type = 'range'
            AND d::date BETWEEN bd.date_from::date AND bd.date_to::date)
        )
    )
  )
```

Parameters: `$1` = comma-separated date list, `$2` = room_id, `$3` = tenant_id, `$4` = start_time, `$5` = end_time.

### 4.5 Duplicate Guard on INSERT

All bulk INSERT workflows include a `NOT EXISTS` guard to prevent race-condition duplicates at the database level:

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

## 5. Database Schema

### 5.1 Schema

All tables live in the `bookings` schema. Every table includes `tenant_id INT NOT NULL` for multi-tenancy (RLS enforcement pending Phase 4).

### 5.2 Core Tables

#### `bookings.recurring_series` — Parent record for recurring contracts

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tenant_id | INT | RLS isolation key |
| customer_id | UUID | FK → customers |
| room_id | UUID | FK → rooms |
| series_name | TEXT | Human label (e.g., "Yoga Mon 9am") |
| frequency | TEXT | weekly \| fortnightly \| monthly \| daily |
| day_of_week | INT | 0 = Sunday … 6 = Saturday |
| start_time | TIME | Session start |
| end_time | TIME | Session end |
| start_date | DATE | Contract start |
| end_date | DATE | Contract end |
| rate_per_session | NUMERIC | £ per session (frozen at contract signing) |
| sessions_per_cycle | INT | 4 (weekly), 2 (fortnightly), 1 (monthly) |
| total_sessions | INT | Total sessions over contract life |
| sessions_completed | INT | Audit count |
| cycle_amount | NUMERIC | Price per billing cycle |
| agreed_price | NUMERIC | Total contract value |
| balance_due | NUMERIC | **Debt lives on parent only** |
| payment_timing | TEXT | in_advance \| in_arrears |
| billing_type | TEXT | monthly \| per_session \| upfront |
| active | BOOLEAN | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `bookings.confirmed_bookings` — Individual sessions (child records)

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tenant_id | INT | RLS isolation key |
| customer_id | UUID | FK → customers |
| room_id | UUID | FK → rooms |
| booking_date | DATE | Session date |
| date_from | DATE | Inclusive range start (for multi-day) |
| date_to | DATE | Inclusive range end |
| start_time | TIME | |
| end_time | TIME | |
| guest_count | INT | |
| balance_due | NUMERIC | **Always 0 when recurring_series_id IS NOT NULL** (trigger enforced) |
| payment_status | TEXT | pending \| paid \| overdue \| cancelled |
| status | TEXT | confirmed \| cancelled \| pending |
| is_recurring | BOOLEAN | True for ghost/recurring markers |
| recurring_series_id | UUID | FK → recurring_series (NULL for standalone) |
| recurring_rule_id | UUID | FK → recurring_rules (membership path) |
| membership_id | UUID | FK → memberships |
| series_label | TEXT | Display label for the series |
| cancellation_reason | TEXT | |
| cancelled_by | TEXT | |
| cancelled_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Key constraint:** Trigger `fn_zero_child_balance()` automatically sets `balance_due = 0` on any child INSERT where `recurring_series_id IS NOT NULL`. All debt tracking is on the parent `recurring_series` row.

#### `bookings.customers`

| Column | Type |
|---|---|
| id | UUID |
| tenant_id | INT |
| full_name | TEXT |
| email | TEXT |
| phone | TEXT |
| company | TEXT |
| created_at | TIMESTAMPTZ |
| updated_at | TIMESTAMPTZ |

#### `bookings.rooms`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| name | TEXT | Display name |
| capacity | INT | Max occupancy |
| rate_per_hour | NUMERIC | Default hourly rate |
| available_from | TIME | Venue open time |
| available_to | TIME | Venue close time |
| is_active | BOOLEAN | |

#### `bookings.memberships`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| customer_id | UUID | |
| plan_name | TEXT | |
| policy_template | TEXT | A \| B \| C (for policy letter generation) |
| monthly_rate | NUMERIC | Headline monthly fee |
| status | TEXT | active \| paused \| cancelled |
| start_date | DATE | |
| end_date | DATE | |
| notice_period_days | INT | Default: 30 |
| notes | TEXT | |

#### `bookings.recurring_rules` — Room/timeslot within a membership

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| membership_id | UUID | FK → memberships |
| room_id | UUID | |
| day_of_week | INT | 0–6 |
| start_time | TIME | |
| end_time | TIME | |
| rate_per_session | NUMERIC | NULL = derive from membership |
| frequency | TEXT | weekly \| fortnightly \| monthly |
| end_date | DATE | NULL = indefinite |
| active | BOOLEAN | |

#### `bookings.payments`

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| booking_id | UUID | FK → confirmed_bookings |
| amount_paid | NUMERIC | |
| payment_method | TEXT | card \| bank \| cash \| cheque |
| payment_date | TIMESTAMPTZ | |
| cancellation_booking_ref | TEXT | |
| cancellation_reason | TEXT | |
| refund_type | TEXT | |

#### `bookings.blocked_dates` — Venue closures and recurring blocks

| Column | Type | Notes |
|---|---|---|
| id | UUID | |
| tenant_id | INT | |
| block_type | TEXT | oneoff \| recurring \| recurring-weekday \| range |
| block_date | DATE | For block_type = 'oneoff' |
| day_of_week | INT | For recurring types (0–6) |
| date_from | DATE | For block_type = 'range' |
| date_to | DATE | For block_type = 'range' |
| reason | TEXT | |

#### `bookings.settings` — Venue configuration

| Column | Type | Notes |
|---|---|---|
| key | TEXT | Setting name |
| value | TEXT | Setting value |

Current settings in use:

| Key | Default | Description |
|---|---|---|
| cancel_full_refund_days | 14 | Days before booking for full refund |
| cancel_partial_refund_days | 7 | Days before booking for partial refund |
| cancel_partial_refund_pct | 50 | Percentage refunded in partial window |

#### `bookings.audit_logs`

Tracks all write operations. Every entry includes `tenant_id`, `action` (CREATE / UPDATE / CANCEL), `entity`, `entity_id`, `payload` (JSON), `performed_by`, and `created_at`.

### 5.3 Key Indexes

```sql
CREATE INDEX idx_confirmed_bookings_tenant    ON bookings.confirmed_bookings(tenant_id);
CREATE INDEX idx_confirmed_bookings_room_date ON bookings.confirmed_bookings(room_id, booking_date);
CREATE INDEX idx_confirmed_bookings_series    ON bookings.confirmed_bookings(recurring_series_id);
CREATE INDEX idx_recurring_series_tenant      ON bookings.recurring_series(tenant_id, active);
CREATE INDEX idx_customers_tenant             ON bookings.customers(tenant_id);
```

---

## 6. API Endpoints

All endpoints are n8n webhook URLs under `https://n8n.srv1090894.hstgr.cloud/webhook`.

### 6.1 Authentication

| Endpoint | Method | Description |
|---|---|---|
| `/onboarding/login` | POST | JWT generation — returns token + user + tenant_id |
| `/onboarding/venues` | GET | List user's venues |
| `/onboarding/create-venue` | POST | Venue registration |
| `/onboarding/reset-password` | POST | Password reset |

### 6.2 Bookings

| Endpoint | Method | Description |
|---|---|---|
| `/create-booking` | POST | Single booking creation |
| `/confirm-booking` | POST | Confirm a pending booking |
| `/cancel-booking` | POST | Cancel with refund calculation |
| `/cancel-pending` | POST | Cancel pending approval requests |
| `/create-recurring-booking` | POST | Create parent series + child sessions |
| `/create-recurring-from-calendar` | POST | Quick-book from calendar drag |
| `/check-recurring-clashes` | POST | Pre-flight availability check |
| `/recurring-make-booking` | POST | Create individual session from series |
| `/recurring-walk-in-booking` | POST | Walk-in session on a series |

### 6.3 Customers

| Endpoint | Method | Description |
|---|---|---|
| `/create-customer` | POST | New customer record |
| `/update-customer` | POST | Update customer details |
| `/get-customers` | GET | Paginated customer list |

### 6.4 Recurring Series Management

| Endpoint | Method | Description |
|---|---|---|
| `/get-recurring-bookings` | GET | Active recurring series for tenant |
| `/update-recurring-rule` | POST | Modify series parameters |
| `/cancel-recurring-series` | POST | Cancel entire series and children |

### 6.5 Rooms

| Endpoint | Method | Description |
|---|---|---|
| `/create-room` | POST | Add new room |
| `/update-room` | POST | Modify room details |
| `/delete-room` | POST | Remove room |
| `/get-rooms` | GET | List rooms for tenant |
| `/vp-rooms-chk-a1` | POST | Real-time room availability check |

### 6.6 Event Types & Services

| Endpoint | Method | Description |
|---|---|---|
| `/add-event-type` | POST | Create event category |
| `/update-event-type` | POST | Modify event type |
| `/delete-event-type` | POST | Remove event type |
| `/get-event-types` | GET | List event types |
| `/add-service` | POST | Add bookable service |
| `/update-service` | POST | Modify service |
| `/delete-service` | POST | Remove service |
| `/get-service-data` | GET | Service catalogue |

### 6.7 Payments

| Endpoint | Method | Description |
|---|---|---|
| `/get-outstanding-payments` | GET | Billing summary |
| `/pay-balance` | POST | Record a payment |
| `/record-recurring-payment` | POST | Log payment on recurring series |
| `/override-recurring-payment` | POST | Manual payment override |
| `/get-accounts-data` | GET | Financial dashboard data |

### 6.8 Calendar & Availability

| Endpoint | Method | Description |
|---|---|---|
| `/calendar-all-bookings` | GET | All events for FullCalendar render |
| `/get-all-bookings` | GET | Booking list with filters |
| `/get-pending-requests` | GET | Pending approval queue |
| `/check-availability` | POST | Real-time slot availability |

### 6.9 Blocked Dates

| Endpoint | Method | Description |
|---|---|---|
| `/blocked-dates` | GET | List venue closures for tenant |
| `/add-blocked-date` | POST | Block a date or range |
| `/delete-blocked-date` | POST | Unblock a date |

### 6.10 Reporting

| Endpoint | Method | Description |
|---|---|---|
| `/get-repeat-clients` | GET | Customer frequency analysis |
| `/customer-interactions` | GET | Activity log |
| `/get-monthly-revenue` | GET | Revenue trend data |
| `/staff-dashboard` | GET | Staff KPI dashboard |

### 6.11 Staff & Admin

| Endpoint | Method | Description |
|---|---|---|
| `/create-user` | POST | Add staff member |
| `/update-status` | POST | Update user status |
| `/delete-user` | POST | Remove user |
| `/get-users` | GET | List staff |
| `/get-settings` | GET | Fetch venue settings |
| `/update-setting` | POST | Modify a setting |

### 6.12 Standard Request / Response Pattern

**Request headers:**
```
Authorization: Bearer <JWT>
X-Tenant-ID: <tenant_id>
Content-Type: application/json
```

**Successful booking response:**
```json
{
  "status": "created",
  "booking_count": 24,
  "series_id": "uuid",
  "customer_id": "uuid",
  "customer_name": "Jane Smith",
  "agreed_price": 480.00,
  "amount_due": 120.00,
  "partial_booking": false,
  "warning": null,
  "first_conflict_date": null
}
```

**Partial booking response (when some dates are clashing):**
```json
{
  "status": "created",
  "booking_count": 16,
  "partial_booking": true,
  "warning": "Series cut short — 2026-06-09 is already booked.",
  "first_conflict_date": "2026-06-09"
}
```

**Not available response:**
```json
{
  "status": "not_available",
  "message": "The first session date (9 June 2026) is already booked for this room."
}
```

---

## 7. Authentication & Security

### 7.1 JWT Storage (Current)

| Key | Value |
|---|---|
| `localStorage['vp_token']` | JWT Bearer token |
| `localStorage['vp_user']` | User object (JSON) |
| `localStorage['vp_tenant_id']` | Tenant ID (numeric string) |
| `localStorage['vp_venue_name']` | Display name |
| `localStorage['vp_venue_id']` | Venue reference |

### 7.2 Current JWT Payload

```json
{
  "user_id": "uuid",
  "exp": 1735689600,
  "iat": 1700001234
}
```

Note: `tenant_id` is currently passed in the request body, not the JWT. This is a security gap addressed in Phase 3 of the migration plan.

### 7.3 Target JWT Payload (Phase 3)

```json
{
  "user_id": "uuid",
  "tenant_id": 1001,
  "role": "admin",
  "exp": 1735689600,
  "iat": 1700001234
}
```

### 7.4 Request Authentication

Every API request includes:

```
Authorization: Bearer <JWT>
X-Tenant-ID: <tenant_id>
```

### 7.5 Current Security Gaps

- `tenant_id` is passed in the request body and can theoretically be forged
- No PostgreSQL Row-Level Security — tenant filtering is application-level only
- No token refresh mechanism — expired tokens require re-login
- No rate limiting on webhook endpoints
- JWT secret stored in n8n credential system (not externalised to a vault)

### 7.6 Cancellation Refund Policy

Refund logic applied by the `CancelBooking` workflow:

| Days Until Booking | Refund |
|---|---|
| ≥ `cancel_full_refund_days` (default: 14) | 100% |
| ≥ `cancel_partial_refund_days` (default: 7) | `cancel_partial_refund_pct`% (default: 50%) |
| < 7 days | 0% (forfeit) |

Values are configurable per tenant via the `bookings.settings` table.

---

## 8. Booking Logic & Data Flows

### 8.1 Single Booking Creation

```
1. User fills booking form (customer, room, date, time, payment)
2. Frontend calls POST /create-booking
3. n8n workflow:
   a. Parse and validate input
   b. Check availability (SELECT WHERE room_id + date + overlapping time + status != cancelled)
   c. If unavailable → Respond: Not Available
   d. Upsert customer (INSERT ... ON CONFLICT DO UPDATE)
   e. INSERT INTO confirmed_bookings
   f. Record payment if paid upfront
   g. Create audit log entry
4. Frontend shows confirmation
```

### 8.2 Recurring Booking Creation

The recurring system uses a **parent-child architecture**. One `recurring_series` row holds the contract metadata and all debt. N child `confirmed_bookings` rows hold individual sessions with `balance_due = 0`.

```
1. User configures recurring form:
   - Room, frequency, start/end date, day-of-week, times
   - Payment timing (in_advance / in_arrears / per_session)

2. Frontend pre-flight:
   a. Generate all candidate dates client-side
   b. Filter against blocked_dates (oneoff, recurring, recurring-weekday, range)
   c. If blocked dates exist → pause and show clash modal with details
   d. POST to /check-recurring-clashes with non-blocked dates + broadest time window
   e. Backend returns clashed_dates[]
   f. If clashes detected → show clash modal: "Series cut short — X is already booked"
   g. User can Proceed (with safe dates) or Cancel (go back)

3. Submission (safe dates only):
   a. POST to /create-recurring-from-calendar or /create-recurring-booking
   b. n8n workflow:
      i.   Parse + validate
      ii.  Re-check clashes server-side (race condition guard)
      iii. Filter dates: remove all dates from first clash onwards
      iv.  Upsert customer
      v.   INSERT INTO recurring_series (1 parent row)
      vi.  Bulk INSERT INTO confirmed_bookings (NOT EXISTS guard prevents duplicates)
      vii. INSERT INTO payment schedule
      viii. Return: booking_count, partial_booking, first_conflict_date

4. Frontend response handling:
   - partial_booking: false → success toast, reload calendar
   - partial_booking: true → informational modal showing how many sessions booked
                             and why the series was cut short
```

### 8.3 Availability Check Logic

Time overlap is detected using the standard interval overlap formula:

```
existing.start_time < requested.end_time
AND
existing.end_time   > requested.start_time
```

This correctly catches all overlap cases:
- Exact match (same start and end)
- Requested session starts during existing
- Requested session ends during existing
- Requested session fully contains existing

### 8.4 Payment Chasing Automation

```
BillingCycleTrigger (scheduled — daily)
  → Query: SELECT * FROM recurring_series
           WHERE tenant_id = ? AND active = true AND balance_due > 0

For each overdue series:
  • 1–30 days overdue  → RecurringPaymentChaser (reminder email)
  • 30–60 days overdue → RecurringPaymentReminder (escalation email)
  • 60+ days overdue   → RecurringAutoCancel:
      - series.active = false
      - All child bookings → status = 'cancelled'
      - Send cancellation notice to customer
```

### 8.5 Cancellation Flow

```
User cancels booking (booking_id)
  → POST /cancel-booking
  → n8n CancelBooking workflow:
      1. Fetch booking details
      2. Calculate refund (days_until_booking vs. settings thresholds)
      3a. If child booking (recurring_series_id IS NOT NULL):
            - Reduce parent.balance_due by refund amount
            - confirmed_bookings.status = 'cancelled'
      3b. If standalone booking:
            - Reverse payment record
            - Issue refund
      4. Create audit log entry
      5. Return: refund_amount, refund_type
```

---

## 9. Multi-Tenancy

### 9.1 Current Implementation

Every database table includes `tenant_id INT NOT NULL`. All n8n workflows receive `tenant_id` in the request body and include it in every SQL `WHERE` clause.

**Tenant configuration file (`tenants.json`):**
```json
{
  "tenants": [
    { "tenant_id": 1001, "venue_id": 1001, "name": "Village Hall A" },
    { "tenant_id": 1002, "venue_id": 1002, "name": "Community Centre B" },
    { "tenant_id": 1003, "venue_id": 1003, "name": "Sports Hall C" }
  ]
}
```

### 9.2 Target Implementation (Phase 3 + 4)

Once the migration is complete, tenant isolation will be enforced at two layers:

**JWT layer:** `tenant_id` extracted from the verified JWT payload, never from the request body.

**Database layer (RLS):**
```sql
-- Session context set by db-api before every query
SET LOCAL app.tenant_id = '<tenant_id_from_jwt>';

-- RLS policy on every table
CREATE POLICY tenant_isolation ON bookings.confirmed_bookings
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::int);

ALTER TABLE bookings.confirmed_bookings FORCE ROW LEVEL SECURITY;
```

If `app.tenant_id` is not set, all queries return zero rows — data never leaks across tenants.

---

## 10. Configuration & Environment

### 10.1 Frontend Constants

| Constant | Value |
|---|---|
| n8n webhook base | `https://n8n.srv1090894.hstgr.cloud/webhook` |
| FullCalendar version | 6.1.10 |
| Font Awesome version | 6.4.0 |

### 10.2 Database Settings (`bookings.settings`)

| Key | Default | Description |
|---|---|---|
| `cancel_full_refund_days` | `14` | Full refund threshold (days before booking) |
| `cancel_partial_refund_days` | `7` | Partial refund threshold |
| `cancel_partial_refund_pct` | `50` | Partial refund percentage |

### 10.3 n8n Environment

- PostgreSQL connection: managed via n8n credential system
- JWT secret: managed via n8n credential system
- Workflow activation: manual per-workflow via n8n UI

---

## 11. Migration Roadmap

The system is planned to evolve through four phases. **Phases 1 and 2 are prerequisites for all security hardening.**

### Phase 1 — Introduce db-api

Create a Node.js / Fastify service as the sole gateway between n8n and PostgreSQL. All SQL moves into this service. n8n workflows switch from Postgres nodes to HTTP calls.

### Phase 2 — Move n8n to db-api (Critical)

Eliminate all direct SQL from n8n. Every database operation becomes a typed HTTP call to db-api. This is the gating phase — Phases 3 and 4 cannot begin until n8n has zero Postgres nodes.

**Migration order:** customer updates → booking creation → booking updates → reads / reporting.

**Exit criteria:** No SQL exists in n8n. All DB calls go through the API. All endpoints validated. Audit logs created.

### Phase 3 — JWT Implementation

Move `tenant_id` into the JWT payload. Remove it from all request bodies. db-api middleware verifies the token on every request and injects tenant context into the PostgreSQL session (`SET LOCAL app.tenant_id`).

**Exit criteria:** All endpoints protected. `tenant_id` removed from request bodies. n8n passes only the Authorization header.

### Phase 4 — Row-Level Security (Zero Downtime Rollout)

Enable RLS on tables in this order: `customers` → `confirmed_bookings` → `recurring_series` → `rooms` → `payments` → `audit_logs`. Each table is enabled, tested, and enforced before moving to the next.

**Rollback plan:** `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;`

**Exit criteria:** RLS enabled and forced on all tenant tables. No cross-tenant access possible. System fully functional.

### Non-Negotiable Architectural Rules

- No Postgres nodes executing SQL in n8n
- No `tenant_id` passed manually from n8n or request bodies
- No business logic inside n8n — orchestration only
- `tenant_id` must come exclusively from verified JWT
- All write operations must create an audit log entry
- Input validation (UUID format, required fields, data types) at the API layer on every endpoint

---

*Document generated from live codebase analysis. Last updated: April 2026.*
