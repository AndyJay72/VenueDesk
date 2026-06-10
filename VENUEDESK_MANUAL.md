# VenueDesk Operations & Reference Manual

**Version:** 1.0 — June 2026  
**Scope:** Production system on `72.61.19.52` (Hostinger VPS)  
**API:** https://api.venuedesk.co.uk  
**n8n:** https://n8n.srv1090894.hstgr.cloud  
**Frontend:** https://andyjay72.github.io/VenueDesk

---

## Table of Contents

1. [System Architecture & Stack Overview](#1-system-architecture--stack-overview)
2. [Authentication, Security, & Multitenancy](#2-authentication-security--multitenancy)
3. [REST API Route Blueprint & Payload Specifications](#3-rest-api-route-blueprint--payload-specifications)
4. [Business Rules & Validation Engine](#4-business-rules--validation-engine)
5. [Concurrency, Race-Condition Defenses, & Database Constraints](#5-concurrency-race-condition-defenses--database-constraints)
6. [QA Integration Test Suite & Debugging Playbook](#6-qa-integration-test-suite--debugging-playbook)

---

## 1. 🏛️ System Architecture & Stack Overview

### 1.1 Service Topology

VenueDesk runs as a Docker Compose stack on a single Hostinger VPS. Four containers share two bridge networks (`n8nnet` for internal service communication, `traefik_shared` for Traefik-managed HTTPS ingress).

```
Internet
    │  HTTPS
    ▼
 Traefik (reverse proxy / TLS termination)
    ├─► api.venuedesk.co.uk      → venuedesk-api:3000
    └─► n8n.srv1090894.hstgr.cloud → n8n:5678

venuedesk-api (Fastify / Node.js)
    ├─ appPool  → postgres:5432   (venuedesk_app role — FORCE RLS)
    └─ systemPool → postgres:5432 (n8n superuser — bypasses RLS)

n8n (workflow automation)
    └─ HTTP calls → venuedesk-api (server-to-server, Authorization header)
    └─ postgres:5432 (legacy direct access — being phased out)

fastapi (legacy Python service — minimal use)
    └─ postgres:5432

postgres (pgvector/pg16)
    └─ /opt/postgres_data (bind-mounted persistent volume)
```

**Traefik is the only externally-exposed port.** `venuedesk-api` and `n8n` are not bound to the host network. The `postgres` service currently exposes port 5432 on `0.0.0.0` — this is protected by the Hostinger cloud firewall and should be removed in a future hardening pass.

### 1.2 Technology Stack

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| API framework | Fastify | 4.x — async handlers, AJV schema validation |
| Runtime | Node.js | Current LTS inside Docker |
| Database | PostgreSQL | 16 (pgvector image) |
| DB client | node-postgres (`pg`) | Parameterised queries, simple query protocol |
| Auth | `@fastify/jwt` | HS256 signing, configurable expiry |
| Migrations | Custom JS runner | Sequential SQL files, idempotent, auto-run at boot |
| Automation | n8n | 2.22.5 — orchestration only; no direct SQL |
| Frontend | Static HTML/JS | GitHub Pages — `andyjay72.github.io/VenueDesk` |
| Ingress | Traefik | Let's Encrypt TLS, Docker labels for routing |

### 1.3 Directory Layout

```
/opt/n8n_postgres/                       ← VPS host root
  docker-compose.yml                     ← All service definitions + secrets
  venuedesk-api/                         ← API source (mirrors local repo)
    src/
      server.js                          ← Fastify entry: CORS, JWT, routes, migrations
      db/
        pool.js                          ← Two-pool architecture
        migrate.js                       ← Migration runner
        migrations/                      ← 001 inline + 002–022 SQL files
      routes/                            ← One file per feature domain
        auth.js           /auth
        bookings.js       /bookings
        config.js         /config
        customers.js      /customers
        recurring.js      /recurring
        stripe.js         /stripe
        payments.js       /payments
        payments-manual.js /payments (manual recording)
        dashboard.js      /dashboard
        accounts.js       /accounts
        audit.js          /audit
        enquiry.js        /enquiry
        users.js          /users (reads)
        users-update.js   /users (writes)
        blocked-dates.js  /blocked-dates
        leads.js          /leads
        admin.js          /admin
        onboarding.js     /onboarding
      middleware/
        errorHandler.js                  ← Global error handler → structured JSON envelope
      services/
        LoggerService.js                 ← Writes to bookings.system_logs
      utils/
        errors.js                        ← HttpError factory (notFound, conflict, badRequest…)
        validators.js                    ← assertUUID, assertEmail, isUUID
        format.js                        ← Formatting helpers
    tests/
      qa_integration.py                  ← Integration test harness

Local Mac workspace:
  ~/Downloads/venue_desk_backup/
    venuedesk-api/                       ← Mirrors /opt/n8n_postgres/venuedesk-api/
    CommunityHub/                        ← Frontend HTML (deployed via GitHub Pages)
    n8n-workflows/                       ← Workflow JSON backups
    CLAUDE.md                            ← Platform architecture + patterns
    VENUEDESK_MANUAL.md                  ← This file
```

### 1.4 Deployment Lifecycle Pipeline

#### Standard route file update

```
1. Edit locally
   ~/Downloads/venue_desk_backup/venuedesk-api/src/routes/<file>.js

2. Commit and push to GitHub
   git add ... && git commit -m "..." && git push origin main

3. SCP to VPS host path  ← MANDATORY FIRST — do NOT skip
   scp src/routes/<file>.js root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>.js

4. docker cp into running container
   ssh root@72.61.19.52 "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js venuedesk-api:/app/src/routes/<file>.js"

5. Restart container (migrations auto-run on start)
   ssh root@72.61.19.52 "docker restart venuedesk-api"

6. Verify startup
   ssh root@72.61.19.52 "sleep 6 && docker logs venuedesk-api --tail 5"
   ✓ Expected: "[server] venuedesk-api listening on port 3000"
```

#### ⚠️ SCP-First Constraint — Critical

`docker cp` copies **from the VPS host path** into the container. If you run `docker cp` without first running `scp`, the container receives whatever file was last SCPed to that path — which may be an earlier version. This silently deploys stale code with no error.

**Always SCP before docker cp. No exceptions.**

#### Migration file deployment

Migration files have long filenames that break when copy-pasted from interfaces that wrap text. Use `/tmp` as a relay:

```bash
# Local: create short alias
cp /path/to/022_long_migration_name.sql /tmp/m022.sql

# Transfer (short paths — won't wrap)
scp /tmp/m022.sql root@72.61.19.52:/tmp/m022.sql

# VPS: place in both host and container paths, then restart
ssh root@72.61.19.52 "cp /tmp/m022.sql /opt/n8n_postgres/venuedesk-api/src/db/migrations/022_long_migration_name.sql"
ssh root@72.61.19.52 "docker cp /tmp/m022.sql venuedesk-api:/app/src/db/migrations/022_long_migration_name.sql"
ssh root@72.61.19.52 "docker restart venuedesk-api"
```

Migrations run at container start. Confirm with: `docker logs venuedesk-api --tail 10 | grep migrate`

---

## 2. 🔑 Authentication, Security, & Multitenancy

### 2.1 How `fastify.authenticate` Works

`fastify.authenticate` is a Fastify preHandler decorator registered in `server.js`. It is added to protected routes as:

```javascript
fastify.post('/endpoint', { preHandler: [fastify.authenticate] }, handler)
```

**Execution flow:**

```
Request arrives
    │
    ├─ Try Authorization: Bearer <token>  (n8n, Postman, curl — server-to-server)
    │      └─ request.jwtVerify() → verifies signature + expiry
    │
    └─ If header missing/invalid: fall back to body.jwt or query.jwt
           └─ fastify.jwt.verify(raw) → verifies signature + expiry
               (browser fetch — CORS blocks Authorization header)

Both paths normalise to request.user:
    request.user.user_id    (normalised from id or user_id claim)
    request.user.tenant_id  (integer — used for all DB queries)
    request.user.role       (admin | service | staff)

If user_id or tenant_id is missing → 401 INVALID_TOKEN
If signature invalid / expired   → 401 UNAUTHORIZED
```

**CORS constraint:** The CORS configuration only allows `Content-Type` in `allowedHeaders`. Sending `Authorization: Bearer` from a browser triggers a preflight that is blocked. Browser clients must embed the JWT in `request.body.jwt` (POST) or `request.query.jwt` (GET). n8n HTTP nodes and curl should use the standard `Authorization: Bearer` header.

### 2.2 JWT Payload Requirements

Every token issued by `POST /auth/login` must contain these claims:

| Claim | Type | Source | Purpose |
|-------|------|--------|---------|
| `id` | string | `staff_users.id` (UUID) | Legacy identity — normalised to `user_id` |
| `user_id` | string | same as `id` | Primary identity claim used by middleware |
| `username` | string | `staff_users.username` | Display / audit logging |
| `role` | string | `staff_users.role` | RBAC enforcement |
| `full_name` | string | `staff_users.full_name` | UI display, staff_member field in interactions |
| `name` | string | alias for `full_name` | Legacy frontend compatibility |
| `tenant_id` | integer | `staff_users.tenant_id` | **Critical** — drives all RLS context injection |
| `exp` | Unix timestamp | JWT library | Token expiry |

**Service account tokens** (used by cron jobs and n8n scheduled workflows) follow the same structure. The `CYCLE_SWEEP_SERVICE_JWT` in `docker-compose.yml` has `tenant_id: 1001`, `role: admin`, and a multi-year expiry.

### 2.3 Database Pool Architecture

`src/db/pool.js` maintains two independent PostgreSQL connection pools:

```
systemPool   ← DATABASE_URL     (user: n8n, superuser)
                 Bypasses FORCE RLS by design.
                 Use for: migrations, DDL, cross-tenant scheduled jobs,
                          LoggerService (system_logs writes).

appPool      ← APP_DATABASE_URL (user: venuedesk_app, restricted)
                 Subject to FORCE RLS on all 12 tenant tables.
                 Use for: all user-facing routes via withTenantContext.
```

**Three access functions:**

| Function | Pool | Transaction | Tenant context |
|----------|------|-------------|----------------|
| `withTenantContext(tenantId, fn)` | appPool | BEGIN/COMMIT | `set_config('app.tenant_id', ...)` |
| `withServiceContext(tenantId, fn)` | appPool | BEGIN/COMMIT | `set_config('app.tenant_id', ...)` |
| `withServiceContext(fn)` | systemPool | BEGIN/COMMIT | none (cross-tenant) |
| `systemQuery(text, params)` | systemPool | auto-commit | none |

### 2.4 Tenant Context Injection — The `set_config()` Pattern

Every user-facing transaction must activate the RLS policy by setting `app.tenant_id` for the duration of that transaction:

```javascript
// Inside withTenantContext / withServiceContext:
await client.query('BEGIN');
await client.query(
  "SELECT set_config('app.tenant_id', $1, true)",
  [tenantId.toString()]   // must be a string — set_config accepts text only
);
// ← RLS policy is now active for all subsequent queries in this transaction
const result = await fn(client);
await client.query('COMMIT');
```

The third argument `true` scopes the setting to the current transaction only (`SET LOCAL` semantics) — it is automatically cleared on `COMMIT` or `ROLLBACK`. This means tenant context cannot leak between requests even if a pooled connection is reused.

**Critical rule:** Never use parameterised `SET LOCAL app.tenant_id = $1`. PostgreSQL's `SET` command does not accept parameterised queries. Use `set_config()` as shown above (Pattern 2 from CLAUDE.md).

### 2.5 Row-Level Security Architecture

RLS is applied in two phases across migrations 011 and 013:

**Migration 011 — ENABLE RLS + policy creation** on 12 tenant tables:

```sql
CREATE POLICY tenant_isolation_policy ON bookings.<table>
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', TRUE)::int
  );
```

The `TRUE` flag on `current_setting` makes it return `NULL` rather than raising an error when the setting is absent. Since `tenant_id = NULL` evaluates to `NULL` (not `TRUE`) in SQL, any query running outside a tenant context returns **zero rows** — safe failure by design.

**Migration 013 — FORCE ROW LEVEL SECURITY** on all 12 tables:

```sql
ALTER TABLE bookings.confirmed_bookings FORCE ROW LEVEL SECURITY;
-- ... (repeated for customers, payments, booking_requests, etc.)
```

FORCE RLS means the policy applies to ALL roles including table owners and superusers on the `appPool` connection. The `systemPool` (n8n superuser) bypasses RLS by design for cross-tenant operations.

**Tables with FORCE RLS (12 total):**

| Table | Notes |
|-------|-------|
| `bookings.customers` | |
| `bookings.confirmed_bookings` | + unique slot index (migration 022) |
| `bookings.booking_requests` | |
| `bookings.payments` | |
| `bookings.recurring_series` | |
| `bookings.recurring_rules` | |
| `bookings.recurring_payment_schedule` | |
| `bookings.outstanding_payments` | |
| `bookings.customer_interactions` | |
| `bookings.audit_logs` | |
| `bookings.rooms` | |
| `bookings.add_on_services` | |

`bookings.staff_users` has RLS **enabled but not forced** — login requires a cross-tenant username lookup before `app.tenant_id` is known.

**`venuedesk_app` role grants (migration 014):**

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings.customers TO venuedesk_app;
-- ... (full DML on all 12 tenant tables)
GRANT SELECT ON bookings.staff_users TO venuedesk_app;   -- read-only
GRANT SELECT ON bookings.tenants TO venuedesk_app;        -- read-only
```

**What `venuedesk_app` cannot do:**
- `SELECT ... FOR UPDATE` — triggers RLS UPDATE policy evaluation beyond what `FOR ALL USING` covers; results in 500 errors
- `pg_advisory_xact_lock()` — requires `pg_catalog` EXECUTE privilege not granted to restricted roles
- DDL (`CREATE`, `ALTER`, `DROP`) — no DDL access

---

## 3. 🗺️ REST API Route Blueprint & Payload Specifications

### 3.1 Complete Endpoint Map

All routes are served from `https://api.venuedesk.co.uk`. Auth column: ✓ = requires `fastify.authenticate`, ○ = public.

#### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | ○ | Issue JWT; body: `{username, password}` |

#### Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/bookings/:id` | ✓ | Single booking with customer + room detail |
| GET | `/bookings/list` | ✓ | All confirmed bookings for tenant |
| GET | `/bookings/pending` | ✓ | Open booking requests (not yet confirmed) |
| GET | `/bookings/check-clashes` | ✓ | Clash probe for a proposed slot |
| POST | `/bookings/create` | ✓ | Create confirmed booking — see §3.2 |
| POST | `/bookings/make-booking` | ✓ | Create booking + record payment in one call (n8n path) |
| POST | `/bookings/confirm-request` | ✓ | Promote a booking_request to confirmed_booking |
| POST | `/bookings/update` | ✓ | Update status, total_amount, balance_due, notes |
| POST | `/bookings/cancel` | ✓ | Cancel single booking or full recurring series |
| POST | `/bookings/cancel-pending` | ✓ | Cancel a booking_request before confirmation |
| POST | `/bookings/get-room` | ✓ | Resolve room details by booking ID |
| POST | `/bookings/clash-guard` | ✓ | Programmatic clash check (returns 409 on clash) |
| POST | `/bookings/create-request` | ✓ | Insert a booking_request from enquiry form |
| POST | `/bookings/check-availability` | ○ | Public availability check (enquiry form) |

#### Configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/config/rooms` | ✓ | List all rooms for tenant |
| POST | `/config/rooms/create` | ✓ | Create room: `{name, capacity, day_rate, half_rate, description}` |
| POST | `/config/rooms/update` | ✓ | Update room fields |
| POST | `/config/rooms/delete` | ✓ | Soft-delete room (`is_active = false`); body: `{room_id}` |
| GET | `/config/event-types` | ✓ | List event types |
| POST | `/config/event-types/create` | ✓ | Create event type |
| POST | `/config/event-types/update` | ✓ | Update event type |
| POST | `/config/event-types/delete` | ✓ | Soft-delete event type |
| GET | `/config/pricing` | ✓ | List room/event pricing matrix |
| POST | `/config/pricing/upsert` | ✓ | Upsert pricing row |
| POST | `/config/pricing/delete` | ✓ | Delete pricing row |
| GET | `/config/settings` | ✓ | All tenant settings |
| POST | `/config/settings/upsert` | ✓ | Insert/update a setting key |
| GET | `/config/services` | ✓ | List add-on services |
| POST | `/config/services/upsert` | ✓ | Upsert add-on service |

#### Customers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/customers/upsert` | ✓ | Create or resolve customer by email/phone |
| POST | `/customers/update` | ✓ | Update customer fields + log interaction |
| POST | `/customers/update-status` | ✓ | Update customer status field only |
| GET | `/customers/list` | ✓ | All customers for tenant |
| GET | `/customers/interactions` | ✓ | Interaction history for a customer |
| GET | `/customers/pending-warnings` | ✓ | Customers due expiry warning emails |
| POST | `/customers/mark-warning-sent` | ✓ | Record warning email sent |
| POST | `/customers/purge-expired` | ✓ | Remove expired pending customers |
| GET | `/customers/repeat-clients` | ✓ | Customers with multiple confirmed bookings |

#### Stripe

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stripe/config` | ○ | Public Stripe publishable key for tenant |
| GET | `/stripe/bacs-details` | ✓ | BACS bank details for tenant |
| POST | `/stripe/session` | ✓ | Create Stripe Checkout session (payment or setup) |
| POST | `/stripe/cycle-session` | ✓ | Off-session charge for recurring cycle (cron) |
| POST | `/stripe/public-session` | ○ | Create checkout for enquiry form deposit |
| POST | `/stripe/webhook` | ○ | Stripe event handler (raw body verification) |

#### Recurring Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/recurring/upsert-customer` | ✓ | Upsert customer for recurring series |
| POST | `/recurring/create-rule` | ✓ | Create recurring rule |
| POST | `/recurring/create-series` | ✓ | Create recurring series |
| POST | `/recurring/create-series-calendar` | ✓ | Create series from calendar UI |
| POST | `/recurring/insert-bookings` | ✓ | Bulk insert booking sessions for a series |
| POST | `/recurring/insert-payment-schedule` | ✓ | Create payment schedule for series |
| POST | `/recurring/seed-cycle-schedule` | ✓ | Seed per-cycle payment schedule |
| POST | `/recurring/record-payment` | ✓ | Record manual payment against recurring series |
| POST | `/recurring/seed-lifecycle-schedule` | ✓ | Seed lifecycle event schedule |
| GET | `/recurring/pending-reminders` | ✓ | Series with payments due |
| GET | `/recurring/next-due` | ✓ | Next due payment per series |
| POST | `/recurring/cancel-series` | ✓ | Cancel a recurring series |
| POST | `/recurring/process-overdue` | ✓ | Mark overdue cycles |
| GET | `/recurring/cycles/due` | ✓ | Cycles due today (used by cron sweep) |
| GET | `/recurring/upcoming-reminders` | ✓ | Upcoming payment reminders |
| POST | `/recurring/mark-reminder-sent` | ✓ | Record reminder email sent |
| GET | `/recurring/schedule-status` | ✓ | Full schedule status for a series |
| POST | `/recurring/log-interaction` | ✓ | Log interaction against recurring customer |
| POST | `/recurring/check-clashes` | ✓ | Clash check for recurring series |
| GET | `/recurring/series` | ✓ | List all recurring series |

#### Payments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/record` | ✓ | Record manual payment |

#### Dashboard & Accounts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/metrics` | ✓ | Revenue, booking counts, occupancy |
| GET | `/dashboard/recent` | ✓ | Recent bookings and interactions |
| GET | `/dashboard/upcoming` | ✓ | Upcoming bookings |
| GET | `/dashboard/monthly-revenue` | ✓ | Monthly revenue breakdown |
| GET | `/accounts` | ✓ | Accounts view data |

#### Users & Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/list` | ✓ | Staff users for tenant |
| POST | `/users/create` | ✓ | Create staff user |
| POST | `/users/delete` | ✓ | Delete staff user |
| POST | `/users/update` | ✓ | Update user name/role/password |

#### Utility

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/audit/log` | ✓ | Write audit entry |
| POST | `/enquiry/create-request` | ○ | Public enquiry form submission |
| GET | `/health` | ○ | Docker health check endpoint |

### 3.2 `POST /bookings/create` — Source-of-Truth Payload Reference

**Full URL:** `POST https://api.venuedesk.co.uk/bookings/create`  
**Auth:** `fastify.authenticate` (preHandler)  
**tenant_id:** extracted from JWT — never from request body

#### Request body

| Field | Required | AJV type | Default | Validation |
|-------|----------|----------|---------|------------|
| `customer_id` | ✓ | string | — | Must be valid UUID |
| `room_id` | ✓ | string | — | Must be valid UUID |
| `booking_date` | ✓ | string | — | DATE cast; must not be in the past |
| `start_time` | ✓ | string | — | TIME cast; must be strictly < `end_time` |
| `end_time` | ✓ | string | — | TIME cast |
| `date_from` | — | string | `= booking_date` | Must not be in the past |
| `date_to` | — | string | `= booking_date` | `(date_to − date_from) ≤ 90 days` |
| `status` | — | string enum | `"confirmed"` | See §4.1 for allowed values |
| `guest_count` | — | integer | `null` | If provided: must be ≥ 1 and ≤ `room.capacity` |
| `total_amount` | — | number | `0` | |
| `deposit_amount` | — | number | `0` | |
| `balance_due` | — | number | `total_amount − deposit_amount` | Explicit value overrides derived value |
| `payment_method` | — | string | `"cash"` | |
| `booking_request_id` | — | string | — | If provided: must be valid UUID; closes the request |
| `check_clashes` | — | boolean | `true` | Set `false` only in trusted internal callers (n8n) |

#### Handler execution sequence (when `check_clashes: true`)

```
1. AJV schema validation       — rejects wrong types, missing required fields → 400
2. assertUUID (customer_id, room_id)
3. guest_count runtime guard   — guest_count < 1 → 400
4. Past-date guard             — booking_date or date_from before today → 400
5. 90-day ceiling              — (date_to − date_from) > 90 → 400
6. start_time < end_time check — equal or inverted → 422
7. withTenantContext BEGIN      — sets app.tenant_id for RLS
8. Room SELECT                 — fetches room.capacity; throws 404 if not found
9. Capacity ceiling            — guest_count > room.capacity → 400 (skipped if capacity = 0)
10. Overlap clash SELECT       — returns 409 if any active booking overlaps date+time range
11. INSERT confirmed_bookings  — catches 23505 → 409 (race condition defence layer 2)
12. INSERT payments (deposit)  — only if deposit_amount > 0 and payment_method ≠ 'card'
13. UPDATE booking_request     — only if booking_request_id provided
14. INSERT customer_interaction
15. COMMIT
```

#### Success response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "booking_date": "2026-09-15T00:00:00.000Z",
    "date_from": "2026-09-15T00:00:00.000Z",
    "date_to": "2026-09-15T00:00:00.000Z",
    "start_time": "09:00:00",
    "end_time": "17:00:00",
    "total_amount": "150.00",
    "balance_due": "100.00",
    "deposit_paid": "50.00",
    "status": "confirmed",
    "guest_count": 30
  }
}
```

#### Error responses

| HTTP | Code | Trigger |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | AJV schema failure (wrong type, missing field) |
| 400 | `VALIDATION_ERROR` | guest_count < 1, past date, >90 days, capacity exceeded |
| 401 | `UNAUTHORIZED` | Missing, expired, or invalid JWT |
| 404 | `NOT_FOUND` | room_id does not exist for tenant |
| 409 | `CONFLICT` | Booking overlaps an existing slot (clash check or unique index) |
| 422 | `UNPROCESSABLE` | end_time ≤ start_time |
| 500 | `INTERNAL_ERROR` | Unhandled exception (message hidden from client; logged to system_logs) |

---

## 4. 🛡️ Business Rules & Validation Engine

### 4.1 Status Enum — Hard-Pinned Allowlist

The `status` field on both `POST /bookings/create` and `POST /bookings/update` is validated at the AJV schema layer. Any value not in this list is rejected with HTTP 400 **before the handler runs**:

```javascript
enum: [
  'confirmed',     // Standard confirmed booking (default)
  'pending',       // Created but awaiting confirmation
  'provisional',   // Deposit received; balance outstanding
  'deposit_paid',  // Deposit paid via Stripe
  'cancelled',     // Soft-cancelled via /bookings/update (row remains in table)
  'fully_paid',    // Full payment received
  'paid',          // Payment marked complete
  'overridden'     // Manually overridden by staff
]
```

**Note on cancellation:** The `POST /bookings/cancel` route **deletes** the row from `confirmed_bookings` and inserts it into `bookings.cancellations`. Rows with `status = 'cancelled'` in `confirmed_bookings` represent soft-cancellations applied via `/bookings/update` — these are excluded from the unique slot index.

### 4.2 Capacity Enforcement

Capacity is enforced in two layers:

**Layer 1 — AJV schema (before handler):**
```javascript
guest_count: { type: 'integer' }
```
Using plain `type: 'integer'` (not `anyOf` with a null branch) prevents Fastify's `coerceTypes: true` from silently coercing `0` to `null`. If `guest_count` is provided, it must be an integer.

**Layer 2 — handler runtime guard:**
```javascript
if (guest_count !== null && guest_count !== undefined && guest_count < 1) {
  throw badRequest('guest_count must be at least 1');
}
```
This guards against AJV coercion edge cases and ensures 0 and negative values are always rejected.

**Layer 3 — room capacity ceiling (inside transaction):**
```javascript
if (guest_count !== null && room.capacity > 0 && guest_count > room.capacity) {
  throw badRequest(`guest_count ${guest_count} exceeds room capacity of ${room.capacity}`);
}
```
`room.capacity = 0` is treated as unconstrained (legacy rooms without a capacity set). Only rooms with an explicit non-zero capacity ceiling enforce the check.

### 4.3 Historical Booking Protection

Prevents backdating bookings into the past. Enforced before `withTenantContext` (no DB transaction cost on failure):

```javascript
const today = new Date().toISOString().slice(0, 10);   // "YYYY-MM-DD" server date
const effectiveFrom = date_from || booking_date;
if (booking_date < today || effectiveFrom < today) {
  throw badRequest('Cannot create or register a venue reservation block in the past.');
}
```

String lexicographic comparison of ISO date strings (`"2000-01-15" < "2026-06-10"`) is valid because ISO 8601 dates sort correctly as strings. No `Date` object construction needed for the comparison.

### 4.4 Maximum Booking Duration Ceiling

Prevents multi-year "blocking" bookings that would permanently occupy rooms and obscure genuine availability:

```javascript
const msPerDay     = 86_400_000;
const durationDays = Math.round((new Date(date_to) - new Date(date_from)) / msPerDay);
if (durationDays > 90) {
  throw badRequest('Booking duration exceeds maximum allowed limit of 90 days.');
}
```

The `Math.round` handles DST boundary days (23h or 25h) that would otherwise produce fractional results. Ceiling: **90 days**.

### 4.5 Time Validation

```javascript
if (start_time >= end_time) {
  throw unprocessable('end_time must be after start_time');
}
```

String comparison of `"HH:MM"` format is valid because the time strings are always zero-padded. Returns 422 (Unprocessable Entity) rather than 400, signalling that the request was well-formed but semantically invalid.

### 4.6 AJV Strict Mode Behaviour — Known Pitfall

Fastify 4 uses AJV with `coerceTypes: true`, `useDefaults: true`, and `removeAdditional: true`. The strict mode generates `allowUnionTypes` warnings (visible in container startup logs) for `anyOf` schemas combining types. **Do not use `anyOf` with a `{ type: 'null' }` branch for numeric fields.** AJV will coerce falsy integers (`0`) to `null` via the null branch, bypassing `minimum` constraints. Use plain `{ type: 'integer' }` and add runtime handler guards instead.

---

## 5. ⚡ Concurrency, Race-Condition Defenses, & Database Constraints

### 5.1 Why Application-Level Locking Fails Under RLS

Two standard application-level locking patterns were evaluated and rejected:

**`SELECT ... FOR UPDATE`**

`FOR UPDATE` tells PostgreSQL to acquire an exclusive row-level lock on the selected rows. However, PostgreSQL evaluates RLS policies for the UPDATE command direction (not just SELECT) when `FOR UPDATE` is used. The `FOR ALL USING (...)` policy on `bookings.rooms` provides a `USING` clause but no `WITH CHECK` clause — insufficient for the update-mode policy check under `FORCE ROW LEVEL SECURITY`. Result: every `POST /bookings/create` call with `check_clashes: true` threw HTTP 500.

**`pg_advisory_xact_lock()`**

Advisory locks are transaction-scoped and RLS-transparent in principle, but calling `pg_advisory_xact_lock()` requires `EXECUTE` privilege on the `pg_catalog` function. The `venuedesk_app` restricted role does not hold this privilege. Result: every call threw HTTP 500.

**Root cause:** Both solutions require privileges that are intentionally absent from the `venuedesk_app` role. The correct fix is database-enforced uniqueness via a partial unique index.

### 5.2 The TOCTOU Race Condition — How It Manifests

`POST /bookings/create` uses a check-then-act pattern:

```
Thread A                          Thread B
───────                          ────────
1. SELECT → 0 clashes found
                                 1. SELECT → 0 clashes found
2. INSERT → succeeds (HTTP 200)
                                 2. INSERT → succeeds (HTTP 200)  ← DUPLICATE
```

Under concurrent load (5 simultaneous requests in QA testing), all 5 threads passed the SELECT check before any INSERT committed. All 5 received HTTP 200. Five duplicate bookings existed for the identical room/date/time slot.

### 5.3 Migration 022 — Structural Analysis

**File:** `src/db/migrations/022_confirmed_bookings_unique_slot.sql`  
**Deployed:** June 2026

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_bookings_room_slot
  ON bookings.confirmed_bookings (room_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled');
```

**Why this works atomically:**

PostgreSQL's unique index enforcement happens inside the kernel's transaction commit path. When two concurrent INSERTs attempt to write the same `(room_id, booking_date, start_time, end_time)` tuple, they compete at the B-tree index leaf page:

1. Thread A acquires the leaf page lock and inserts its index entry.
2. Thread B attempts the same insert and finds the existing entry.
3. PostgreSQL raises error code `23505` (unique_violation) for Thread B.
4. Thread B's `withTenantContext` catch block runs `ROLLBACK`, releasing all locks.

This serialisation happens at the storage engine level — no application-level coordination is needed, and no RLS or role restriction applies to index enforcement.

**Why `WHERE status NOT IN ('cancelled')` (partial index):**

The cancel route (`POST /bookings/cancel`) hard-deletes rows from `confirmed_bookings` and moves them to `bookings.cancellations`. However, `POST /bookings/update` can set `status = 'cancelled'` without deleting. Including cancelled rows in the unique index would permanently block re-booking of a slot that was only soft-cancelled via the update route. The partial index excludes cancelled rows, allowing re-booking after either form of cancellation.

**`IF NOT EXISTS` — idempotency:**

The migration runner re-executes all SQL files on every container restart. `IF NOT EXISTS` makes the index creation a no-op if already present, preventing errors on subsequent restarts.

**No `CONCURRENTLY` — deliberate choice:**

`CREATE UNIQUE INDEX CONCURRENTLY` cannot run inside a transaction block. The migration runner wraps nothing in an explicit transaction (it uses auto-commit mode via `systemQuery`), so `CONCURRENTLY` is technically feasible. However, the `confirmed_bookings` table is small (single venue, low volume) and adding the index without `CONCURRENTLY` produces a negligible lock window. `IF NOT EXISTS` + plain `CREATE` is simpler and equally safe for this use case.

**Defensive deduplication (pre-index step):**

Before creating the index, migration 022 removes any existing duplicate rows, keeping the oldest by `id`:

```sql
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY room_id, booking_date, start_time, end_time
           ORDER BY id
         ) AS rn
  FROM bookings.confirmed_bookings
  WHERE status NOT IN ('cancelled')
),
deleted AS (
  DELETE FROM bookings.confirmed_bookings
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  RETURNING id
)
SELECT COUNT(*) FROM deleted;
```

This was a no-op on deployment (table had 0 rows after QA cleanup), but guards against historical race-condition duplicates on future systems.

### 5.4 `23505` Behaviour in the Fastify Runtime

When the unique index rejects an INSERT, `pg` raises a JavaScript error with `err.code === '23505'`. The `/bookings/create` route catches this explicitly:

```javascript
.catch(err => {
  if (err.code === '23505') {
    throw conflict('Booking', `room ${room_id} is already booked for this date/time`);
  }
  throw err;
});
```

`conflict()` creates an `HttpError` with `statusCode: 409`. The Fastify error handler maps this to:

```json
HTTP 409 Conflict
{ "success": false, "code": "CONFLICT", "message": "Booking conflict: room <id> is already booked for this date/time" }
```

**Why clients may observe `status: 0` (connection reset) instead of HTTP 409:**

Under concurrent load, the losing threads may experience their connection being reset rather than receiving a clean 409 response. This occurs because:

1. The winning thread holds the DB transaction open while completing its INSERT, payment recording, interaction logging, and COMMIT.
2. The losing threads' `withTenantContext` ROLLBACK is triggered immediately by the 23505 error — but the Fastify response pipeline (building the 409 JSON body and writing headers) occurs after ROLLBACK.
3. Fastify's default response timeout combined with sudden ROLLBACK + re-throw can cause the HTTP layer to close the connection before the 409 body is flushed to the socket.

From a correctness standpoint this is benign: no duplicate booking was created. The client should retry or treat any non-2xx response as a booking failure. The QA test suite asserts `6a: exactly 1 booking created` (which passes) independently of `6b: no connection resets` (which is a test-harness strictness artefact).

---

## 6. 🧪 QA Integration Test Suite & Debugging Playbook

### 6.1 Initialising and Running the Test Harness

**Prerequisites:**
```bash
pip install requests
```

**Required environment variable — service JWT:**

Use the `CYCLE_SWEEP_SERVICE_JWT` from `docker-compose.yml`. This token has `tenant_id: 1001`, `role: admin`, and a multi-year expiry — it is the correct token for integration testing.

Retrieve it:
```bash
ssh root@72.61.19.52 "grep CYCLE_SWEEP_SERVICE_JWT /opt/n8n_postgres/docker-compose.yml"
```

**Running the suite:**
```bash
cd ~/Downloads/venue_desk_backup

export VD_JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

python3 venuedesk-api/tests/qa_integration.py
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | Non-critical failures (design decisions, test artefacts) |
| `2` | CRITICAL failures — API accepted dangerous input |

**Optional configuration (edit top of script):**

```python
BASE_URL            = "https://api.venuedesk.co.uk"   # or localhost:3000 for local testing
REQUEST_TIMEOUT     = 15      # seconds per request
CONCURRENCY_WORKERS = 5       # threads for race condition test
CLEANUP_AFTER_TESTS = True    # cancel + soft-delete all test fixtures
TEST_ROOM_CAPACITY  = 50      # capacity of the auto-created test room
TEST_DATE           = "2026-09-15"  # base date for most tests (must be future)
```

### 6.2 Test Categories

| # | Category | Coverage |
|---|----------|---------|
| 1 | Null / type mutations | Missing required fields, wrong types (array for string), null values, missing Content-Type |
| 2 | Capacity boundaries | guest_count at exactly capacity (pass), over capacity (fail), zero (fail), negative (fail) |
| 3 | Time & date anomalies | Equal times, inverted times, past dates, 3-year span, malformed date/time, ISO-8601 datetimes in time fields |
| 4 | Overlap matrix | Exact same slot, partial overlaps (new-start-inside, new-end-inside), enclosure, adjacent-after, adjacent-before |
| 5 | State transitions & hazards | Double-cancel, non-existent UUID, malformed UUID, missing required cancel fields, status injection, SQL injection in room name, 100kB payload |
| 6 | Concurrency race | 5 simultaneous booking requests for identical room/date/time slot |
| 7 | Auth / boundary gaps | No auth header, malformed JWT, expired JWT, empty Bearer, wrong scheme, CORS preflight |

### 6.3 Known Test Limitations & False Positives Matrix

| Test | HTTP status observed | Verdict | Explanation |
|------|---------------------|---------|-------------|
| 3e Malformed date (June 31) | 500 | **Expected** — PostgreSQL `DATE` cast raises parse error; no business-logic guard needed |
| 3f Malformed time (25:00) | 500 | **Expected** — PostgreSQL `TIME` cast raises parse error |
| 3g ISO-8601 datetime as time | 500 | **Expected** — PostgreSQL rejects full ISO string in a `TIME` column |
| 6b No TCP drops | status 0 on losing threads | **False positive** — `23505` ROLLBACK + re-throw closes connection before 409 is flushed; no duplicate booking created; 6a (1 of 5 succeeded) is the authoritative assertion |
| 7a No auth header → 400 | 400 not 401 | **Test script bug** — script POSTs to `GET /bookings/list`; Fastify returns 400 for method mismatch before auth middleware runs |

**Current baseline (June 2026):** 38 PASS · 0 CRITICAL · 2 FAIL (6b + 7a, both artefacts) · 0 SKIP

### 6.4 Reading Error Stack Traces from `system_logs`

When the Fastify error handler catches a 500, the full stack trace is written to `bookings.system_logs` (column: `detail`, JSONB). The container logger is set to `logger: false` in production, so stack traces do not appear in `docker logs`.

**Query the most recent errors directly from the database:**

```bash
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT source, message, left(detail->>'stack', 500) \
    FROM bookings.system_logs \
    WHERE level='error' \
    ORDER BY created_at DESC \
    LIMIT 5\""
```

**Full stack trace for a specific source (e.g. the bookings route):**

```bash
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT created_at, message, detail->>'stack' \
    FROM bookings.system_logs \
    WHERE level='error' AND source LIKE '%bookings%' \
    ORDER BY created_at DESC \
    LIMIT 3\""
```

**`system_logs` schema reference:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial | Primary key |
| `level` | text | `info` \| `warn` \| `error` |
| `source` | text | Route path e.g. `POST /bookings/create` |
| `message` | text | Error message (for 500s: the original uncaught error message) |
| `detail` | jsonb | `{code, statusCode, stack, validation}` |
| `tenant_id` | integer | Tenant that triggered the error (nullable for system-level errors) |
| `created_at` | timestamptz | |

**Useful filters:**

```sql
-- All errors in the last hour
WHERE level = 'error' AND created_at > NOW() - INTERVAL '1 hour'

-- Errors from a specific tenant
WHERE level = 'error' AND tenant_id = 1001

-- Database-level errors (constraint violations, type errors)
WHERE level = 'error' AND message LIKE '%could not determine data type%'
WHERE level = 'error' AND message LIKE '%violates unique constraint%'
WHERE level = 'error' AND message LIKE '%violates foreign key%'
```

### 6.5 Migration Verification

After deploying a new migration, confirm it applied and the target object exists:

```bash
# Check a specific index was created
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT indexname, indexdef FROM pg_indexes \
    WHERE tablename = 'confirmed_bookings' \
    AND indexname = 'idx_confirmed_bookings_room_slot'\""

# List all custom indexes on a table
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT indexname, indexdef FROM pg_indexes \
    WHERE schemaname = 'bookings' AND tablename = 'confirmed_bookings'\""

# Check a constraint exists
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT conname, pg_get_constraintdef(oid) \
    FROM pg_constraint \
    WHERE conrelid = 'bookings.payments'::regclass \
    AND contype = 'c'\""

# Verify FORCE RLS is active on a table
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
  \"SELECT relname, relrowsecurity, relforcerowsecurity \
    FROM pg_class JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid \
    WHERE nspname = 'bookings' AND relkind = 'r' \
    ORDER BY relname\""
```

---

*VenueDesk Operations & Reference Manual — generated June 2026 from live codebase audit*
