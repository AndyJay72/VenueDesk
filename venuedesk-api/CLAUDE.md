# venuedesk-api — Developer Reference

Fastify/Node.js REST API. Runs in Docker on the VPS.  
Production URL: **https://api.venuedesk.co.uk**  
Container name: `venuedesk-api`  
Host source path: `/opt/n8n_postgres/venuedesk-api/`

---

## Stack

| Layer | Tech |
|-------|------|
| HTTP framework | Fastify 4 |
| Auth | `@fastify/jwt` (HS256) |
| Database | PostgreSQL via `pg` (node-postgres) |
| ORM | None — raw parameterised SQL |
| Schema validation | AJV (Fastify built-in, strict mode) |
| Migrations | Custom runner: `src/db/migrate.js` — runs at container start |

---

## Directory Layout

```
src/
  server.js               — Fastify entry: CORS, JWT, routes, migrations
  db/
    pool.js               — Two-pool architecture (appPool + systemPool)
    migrate.js            — Migration runner (sequential, idempotent)
    migrations/           — SQL files run in filename order
  routes/                 — One file per feature area (see Route Map below)
  middleware/
    errorHandler.js       — Global Fastify error handler → structured JSON
  services/
    LoggerService.js      — Writes to bookings.system_logs
  utils/
    errors.js             — HttpError factory (notFound, conflict, badRequest…)
    validators.js         — assertUUID, assertRequired, assertEmail, isUUID
    format.js             — Formatting helpers
tests/
  qa_integration.py       — Integration test harness (see QA section below)
```

---

## Route Map

| Prefix | File | Notes |
|--------|------|-------|
| `/auth` | `auth.js` | Login, JWT issuance |
| `/bookings` | `bookings.js` | Booking lifecycle (create, cancel, list, update) |
| `/config` | `config.js` | Rooms, event types, pricing, settings, **add-on services** |
| `/customers` | `customers.js` | CRM — upsert, update, list, `GET /interactions`, `POST /log-interaction` |
| `/recurring` | `recurring.js` | Recurring series, rules, payment schedule |
| `/stripe` | `stripe.js` | Checkout sessions, cycle-session, webhook handler |
| `/payments` | `payments.js` | Payment reads and balance queries |
| `/payments-manual` | `payments-manual.js` | Dashboard manual payment recording |
| `/dashboard` | `dashboard.js` | Scorecard, pending requests list |
| `/accounts` | `accounts.js` | Accounts view data |
| `/audit` | `audit.js` | Audit log write endpoint |
| `/enquiry` | `enquiry.js` | Public enquiry form (no auth) |
| `/admin` | `admin.js` | Admin-only operations |
| `/onboarding` | `onboarding.js` | New tenant setup |
| `/leads` | `leads.js` | Lead management |
| `/users` | `users.js` | Staff user reads |
| `/users` | `users-update.js` | Staff user writes (update, password) |
| `/blocked-dates` | `blocked-dates.js` | Venue blocked date rules |
| `/health` | `health.js` | Liveness ping (no auth) + health pulse cron endpoint |

### /config route detail

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/config/rooms` | List rooms for tenant — returns `id, name, capacity, day_rate, half_rate, description, is_active, open_time, close_time` |
| POST | `/config/rooms/create` | Insert room — accepts `open_time`, `close_time` (TIME strings); stores NULL when blank (no restriction) |
| POST | `/config/rooms/update` | Update room fields — accepts `open_time`, `close_time`; blank clears to NULL; omitted preserves current |
| POST | `/config/rooms/delete` | Soft-delete (is_active = false) |
| GET | `/config/event-types` | List event types |
| POST | `/config/event-types/create` | Insert event type |
| POST | `/config/event-types/update` | Update event type |
| POST | `/config/event-types/delete` | Soft-delete event type |
| GET | `/config/pricing` | List room_event_pricing with names |
| POST | `/config/pricing/upsert` | Insert or update pricing override |
| POST | `/config/pricing/delete` | Delete pricing override |
| GET | `/config/settings` | All settings for tenant |
| POST | `/config/settings/upsert` | Insert or update a single setting key |
| GET | `/config/services` | List add-on services (`bookings.add_on_services`) |
| POST | `/config/services/upsert` | Insert or update a service (UUID id required if updating) |
| POST | `/config/services/delete` | Delete a service by UUID |
| GET | `/config/policy-templates` | List saved policy templates for tenant (0–3 rows, one per code A/B/C) |
| POST | `/config/policy-templates/upsert` | Upsert a policy template keyed by `(tenant_id, code)` |

**Services auth note:** `/config/services*` endpoints support both staff JWT (`tenant_id` from token)
and service JWT (`tenant_id` from `?tenant_id` query param on GET, or `body.tenant_id` on POST).
The `additionalProperties: false` schema on upsert and delete explicitly allows `jwt` and `tenant_id`
fields so the Pattern 4 browser body-tunnel works without schema rejection.
The frontend (`admin-config.html`) calls these directly — bypassing the broken n8n `ServicesAPI`
proxy — using `?jwt=<token>` for GET and `{ jwt: _TOKEN(), ...fields }` for POST.

### /admin route detail (June 24 2026)

All `/admin` routes enforce `role: 'admin'` via a scope-level `addHook('preHandler')`.
Called by the n8n `OnboardingManager` workflow using `CYCLE_SWEEP_SERVICE_JWT` (service JWT
with `role: 'admin'`, `tenant_id: 1001`). Use `systemQuery` (bypasses RLS — cross-tenant).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin/jobs` | admin JWT | List registered cron jobs from JOB_REGISTRY |
| POST | `/admin/run-job` | admin JWT | Manually trigger a cron job |
| GET | `/admin/logs` | admin JWT | Query `bookings.system_logs` (infra logs) |
| GET | `/admin/scheduler-health` | admin JWT | Last run result per scheduled job |
| POST | `/admin/payment-settings/load` | admin JWT | Load Stripe/BACS config for tenant |
| POST | `/admin/payment-settings/save` | admin JWT | Update Stripe/BACS config |
| POST | `/admin/audit-log` | admin JWT | Insert onboarding admin action to `admin_audit_log` |
| GET | `/admin/system-logs` | admin JWT | Read `admin_audit_log` for onboarding audit modal |

**`POST /admin/audit-log` body:** `{ admin_id, target_tenant, action_type, details, timestamp }`
Only `action_type` is required. Called by n8n fan-out nodes after create/reset/toggle operations.
Returns 400 (not 401) when called without a body — AJV schema validates before auth hook runs.

**`GET /admin/system-logs`** returns `{ success, data: [...], count }` sorted newest-first.
Optional query params: `limit` (default 100, max 500), `action_type` (filter).

### /health route detail (June 24 2026)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health/ping` | **None** | Unauthenticated liveness check — returns `{ok:true,ts:"..."}`. Used by onboarding telemetry panel `performance.now()` loop every 30 s. No DB round-trip. |
| POST | `/health/pulse` | JWT | n8n `Cron: Health Pulse` (*/5 cron) writes heartbeat to `bookings.system_health`. Body: `{source, timestamp}`. |

`GET /health` (root, not `/health/ping`) also exists in `server.js` and returns `{status:"ok"}` — used by Docker health checks.

---

## Database Pools

**Two pools — never mix them.**

```
appPool     — venuedesk_app restricted role — FORCE RLS enforced
systemPool  — n8n superuser — bypasses RLS intentionally
```

| Function | Pool | Use for |
|----------|------|---------|
| `withTenantContext(tenantId, fn)` | appPool | All user-facing routes |
| `withServiceContext(tenantId, fn)` | appPool | n8n proxy with explicit tenant |
| `withServiceContext(fn)` | systemPool | Cross-tenant scheduled jobs |
| `systemQuery(text, params)` | systemPool | Migrations, DDL, system_logs |

### Pool size configuration (source: `src/db/pool.js`)

| Pool | `max` | `idleTimeoutMillis` | `connectionTimeoutMillis` | Notes |
|------|-------|---------------------|---------------------------|-------|
| `systemPool` | **5** | 30 000 ms | 5 000 ms | Superuser — migrations, DDL, cross-tenant jobs only. Low cap is intentional: exhaustion here stalls migrations, not user traffic. |
| `appPool` | **20** | 30 000 ms | 5 000 ms | RLS-restricted role — all user-facing routes. 20 connections is the primary exhaustion ceiling under concurrent load. |

**Exhaustion profiles:**
- Under normal load a single Fastify instance holds roughly `concurrency × avg_query_ms / 1000` connections at any moment. 20 concurrent requests each holding a 50 ms query ≈ 1 connection in use.
- The QA 5-thread race peaks at 5 simultaneous clients; `connectionTimeoutMillis: 5_000` means requests queue for up to 5 s before throwing a pool timeout error.
- If logs show `Error: timeout exceeded when trying to connect`, appPool is exhausted — either increase `max` (Postgres default `max_connections` is 100 on this VPS) or identify the route holding a client past its transaction.
- `systemPool` max 5 is deliberately low: migrations are sequential and DDL must never compete with user traffic for connection slots.

**Always use `set_config()` for tenant injection (never parameterised SET):**
```javascript
// CORRECT — Pattern 2 from parent CLAUDE.md
await client.query(
  "SELECT set_config('app.tenant_id', $1, true)",
  [tenantId.toString()]   // must be string
);
```

---

## Authentication

### PEPPER alignment — critical (June 25 2026)

Both `auth.js` and `onboarding.js` hash passwords with SHA512 + PEPPER.
They MUST use the same PEPPER or accounts created via onboarding can never log in.

| File | Fallback PEPPER (if env var not set) |
|------|--------------------------------------|
| `auth.js` | `'vp-pepper-change-me'` ← correct |
| `onboarding.js` | `'vp-pepper-change-me'` ← fixed June 25 (was `'vp-pepper-change-me-in-env'`) |

**Rule:** Always set `PASSWORD_PEPPER` in docker-compose.yml to a real secret so both
files use the same env var and the fallback mismatch is irrelevant. If `PASSWORD_PEPPER`
is not set, both files now fall back to the same string — correct behaviour.

Any staff account created while the PEPPER was mismatched (`'vp-pepper-change-me-in-env'`)
cannot log in. Fix: reset their password via the onboarding portal's Reset Password button,
which re-hashes with the current (correct) PEPPER.

### Middleware

`fastify.authenticate` is a `preHandler` decorator. It tries:
1. `Authorization: Bearer <token>` header (n8n, Postman, curl — server-to-server)
2. `request.body.jwt` or `request.query.jwt` (browser fetch — CORS constraint)

Both paths normalise to `request.user` with fields: `user_id`, `tenant_id`, `role`.

### JWT claims required

Every token must contain `(user_id || id)` + `tenant_id` + `role`. Missing either → 401 `INVALID_TOKEN`.

### Auth in new routes

```javascript
fastify.post('/my-endpoint', {
  preHandler: [fastify.authenticate],
  schema: { body: { ... } },
}, async (request) => {
  const tenantId = request.user.tenant_id;
  return withTenantContext(tenantId, async (client) => {
    // queries here
  });
});
```

---

## Error Handling

All errors thrown inside route handlers propagate to `errorHandler.js` which returns:
```json
{ "success": false, "code": "...", "message": "..." }
```

### HTTP status → code mapping

| Status | Code | Factory |
|--------|------|---------|
| 400 | `VALIDATION_ERROR` | `badRequest(message)` |
| 401 | `UNAUTHORIZED` | (auth middleware) |
| 403 | `FORBIDDEN` | `forbidden(reason)` |
| 404 | `NOT_FOUND` | `notFound(entity, id)` |
| 409 | `CONFLICT` | `conflict(entity, detail)` |
| 422 | `UNPROCESSABLE` | `unprocessable(message)` |
| 500 | `INTERNAL_ERROR` | (unhandled exception) |

**Message visibility:** For 500s, the message is hidden (`"An internal error occurred"`). For all other statuses, `error.message` is returned to the client. **Never put sensitive data in error messages below 500.**

### Fastify AJV validation errors

Schema validation failures return 400 with `code: VALIDATION_ERROR` automatically — no manual checking needed. The error body from AJV is passed through.

---

## Fastify AJV Configuration — Critical Gotchas

Fastify 4 uses AJV with these defaults that affect schema behaviour:

| Setting | Value | Effect |
|---------|-------|--------|
| `coerceTypes` | `true` | Strings/numbers coerced to match schema type |
| `useDefaults` | `true` | Schema `default` values injected into body |
| `removeAdditional` | `true` | Properties not in schema are stripped from body |
| `strict` | partial | Type union warnings via `allowUnionTypes` |

### Rule: Never use `anyOf` with a `null` branch for numeric fields

`coerceTypes: true` causes AJV to coerce falsy integers (`0`, `-0`) to `null` via the `{ type: 'null' }` branch of an `anyOf`. The request is accepted with the field silently changed to `null`.

```javascript
// WRONG — 0 passes schema (coerced to null), reaches handler as null
guest_count: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }

// CORRECT — plain integer; JS destructuring default handles absent field
guest_count: { type: 'integer' }
// In handler:
const { guest_count = null } = request.body;
if (guest_count !== null && guest_count !== undefined && guest_count < 1) {
  throw badRequest('guest_count must be at least 1');
}
```

### Rule: All `$N` parameters must be referenced in the SQL body

The `pg` driver sends ALL parameters to PostgreSQL via the extended query protocol. PostgreSQL must type-infer every `$1`–`$N` slot. If `$3` is in the values array but never appears in the SQL text, PostgreSQL throws:

```
error: could not determine data type of parameter $3
```

This causes a 500 with no indication of which query failed. Check every SQL + params pair:

```javascript
// WRONG — booking_date is $3 but never appears in the SQL
[room_id, tenantId, booking_date, date_from, date_to, start_time, end_time]

// CORRECT — remove the dead param and renumber
[room_id, tenantId, date_from, date_to, start_time, end_time]
// Then update: $4→$3, $5→$4, $6→$5, $7→$6 in the SQL
```

---

## RLS / appPool Constraints

The `venuedesk_app` role is a restricted role subject to FORCE RLS on all 12 tenant tables. This imposes constraints that do **not** apply to `systemPool`:

### Do NOT use in routes (appPool/withTenantContext):

- `SELECT ... FOR UPDATE` — triggers RLS UPDATE policy evaluation. The `FOR ALL USING (...)` policy without `WITH CHECK` is insufficient for the UPDATE direction → 500.
- `pg_advisory_xact_lock(...)` — requires `pg_catalog` EXECUTE privilege not granted to `venuedesk_app` → 500.
- Any DDL (CREATE, ALTER, DROP) — restricted role has no DDL access.

### Correct concurrency approach (IMPLEMENTED):

Migration 022 adds `idx_confirmed_bookings_room_slot` — a partial unique index on
`confirmed_bookings(room_id, booking_date, start_time, end_time) WHERE status <> 'cancelled'`.
The `/bookings/create` INSERT catches PostgreSQL error `23505` (unique_violation) and returns
HTTP 409, identical to a normal clash-check rejection. Deployed June 2026.

---

## Migration System

Migrations live in `src/db/migrations/` and run automatically on container start via `src/db/migrate.js`.

**Adding a migration:**
1. Create `src/db/migrations/022_description.sql`
2. Write idempotent SQL (`IF NOT EXISTS`, `DO $$ IF NOT EXISTS ... $$`)
3. SCP to VPS + docker cp + `docker restart venuedesk-api`

**Naming:** Files run in lexicographic order. Use `0NN_` prefix. Never renumber existing files — the runner tracks executed migrations by filename.

**Latest migration:** `027_tenants_contact_name.sql` (June 25 2026 — adds `contact_name TEXT` to `bookings.tenants`; used by `GET /onboarding/venues` via `COALESCE(t.contact_name, u.full_name)` and written by `POST /onboarding/update-venue`)
**Next number:** `027`

---

## Deployment Checklist

**Always SCP before docker cp — skipping SCP deploys stale code silently.**

```bash
# 1. Edit locally
# 2. Commit + push
git add src/routes/<file>.js && git commit -m "..." && git push origin main

# 3. SCP to VPS host path (REQUIRED — do not skip)
scp src/routes/<file>.js root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>.js

# 4. Inject into running container + restart
ssh root@72.61.19.52 \
  "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js \
              venuedesk-api:/app/src/routes/<file>.js && \
   docker restart venuedesk-api && sleep 6 && docker logs venuedesk-api --tail 5"

# 5. Confirm startup log contains:
#    [server] venuedesk-api listening on port 3000
```

**server.js changes:** SCP puts server.js in the routes directory by mistake — move it first:
```bash
ssh root@72.61.19.52 "mv /opt/n8n_postgres/venuedesk-api/src/routes/server.js \
                           /opt/n8n_postgres/venuedesk-api/src/server.js"
```

---

## Debugging — Reading Actual Errors

The error handler logs 500s to `bookings.system_logs`. Query directly:

```bash
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db \
  -c \"SELECT source, message, left(detail->>'stack', 500) \
       FROM bookings.system_logs WHERE level='error' \
       ORDER BY created_at DESC LIMIT 5\""
```

`bookings.system_logs` columns: `id`, `level`, `source`, `message`, `detail` (jsonb), `tenant_id`, `created_at`.  
The stack trace is at `detail->>'stack'`.

---

## Pattern 12 — UTC-Anchored Date Guards (BST/DST Boundary Fix)

**Problem:** `new Date().toISOString().slice(0, 10)` and `new Date(dateStr)` use the Node.js
process's local timezone. On a VPS running `Europe/London`, the clock shifts +1 h during BST.
At 23:00 UTC in summer the process's "today" is already tomorrow — the past-date guard rejects
valid same-day bookings made in the evening, and the 90-day ceiling miscounts by one day at
DST transition boundaries.

**Rule:** Use `Date.UTC()` to anchor "today" and `parseUTC()` for duration arithmetic.
Never construct a `Date` from a bare `YYYY-MM-DD` string (implicit local TZ).

```javascript
// Past-date guard
const _now    = new Date();
const todayMs = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate());
const today   = new Date(todayMs).toISOString().slice(0, 10);  // YYYY-MM-DD UTC

// Duration ceiling — months are 0-indexed in Date.UTC()
const parseUTC     = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msPerDay     = 86_400_000;
const durationDays = Math.round((parseUTC(date_to) - parseUTC(date_from)) / msPerDay);
```

**Deployed:** June 11 2026. QA confirmed: 38 PASS · 0 CRITICAL · 0 regressions.

---

## QA Integration Test Suite

**Script:** `tests/qa_integration.py`

```bash
pip install requests
export VD_JWT_TOKEN="<CYCLE_SWEEP_SERVICE_JWT from docker-compose.yml>"
python3 tests/qa_integration.py
```

Exit codes: `0` = all pass · `1` = non-critical failures · `2` = CRITICAL (API accepted dangerous input)

**Test categories:**

| # | Category | Key checks |
|---|----------|-----------|
| 1 | Null/type mutations | Missing fields, wrong types, empty body |
| 2 | Capacity boundaries | guest_count: exact/over/zero/negative |
| 3 | Time/date anomalies | Equal times, inverted times, past dates, malformed |
| 4 | Overlap matrix | Exact/partial/enclosing clashes + adjacent slots |
| 5 | State transitions | Double-cancel, bad UUIDs, status injection, SQL injection |
| 6 | Concurrency race | 5 simultaneous booking requests for same slot |
| 7 | Auth boundaries | Missing/malformed/expired JWT, wrong scheme, CORS |

**Known test limitations (not API bugs):**

| Test | Behaviour | Reason |
|------|-----------|--------|
| 3c Historical date | 400 | ✅ Fixed — past-date guard |
| 3d 3-year span | 400 | ✅ Fixed — 90-day ceiling |
| 5a Double-cancel | 404 | ✅ Fixed — previously blocked by 3d's booking |
| 6a Race condition | 1 of 5 succeeds | ✅ Fixed — migration 022 unique index |
| 6b No TCP drops | status 0 on 4 threads | Harness artefact — 23505 closes connection before losers get clean 409; functionally correct |
| 7a No-auth header | 400 not 401 | Test script bug — POSTs to a GET endpoint; 400 is correct |

**Current baseline (June 2026, UTC patch deployed June 11 2026):** 38 PASS · 0 CRITICAL · 2 FAIL (6b + 7a — test artefacts) · 0 SKIP

---

## /bookings/create — Field Reference

| Field | Required | Schema type | Validation |
|-------|----------|-------------|------------|
| `customer_id` | ✓ | string | assertUUID |
| `room_id` | ✓ | string | assertUUID |
| `booking_date` | ✓ | string | PG DATE cast; must not be in the past |
| `date_from` | — | string | Defaults to booking_date; must not be in the past |
| `date_to` | — | string | Defaults to booking_date; (date_to − date_from) ≤ 90 days |
| `start_time` | ✓ | string | PG TIME cast; must be < end_time |
| `end_time` | ✓ | string | PG TIME cast |
| `status` | — | string enum | confirmed/pending/provisional/deposit_paid/cancelled/fully_paid/paid/overridden; default: confirmed |
| `guest_count` | — | integer | Handler guard: must be ≥ 1 if provided; must not exceed room.capacity |
| `total_amount` | — | number | Default: 0 |
| `deposit_amount` | — | number | Default: 0 |
| `balance_due` | — | number | Derived: total − deposit if omitted |
| `payment_method` | — | string | Default: cash |
| `booking_request_id` | — | string | assertUUID if present |
| `check_clashes` | — | boolean | Default: true; false = skip clash check (internal use only) |

**When `check_clashes: true`:**
1. Past-date guard: `booking_date` / `date_from` < today → 400 (today anchored to UTC midnight via `Date.UTC()` — see Pattern 12)
2. Duration ceiling: `(date_to − date_from) > 90 days` → 400 (duration computed via `parseUTC()` — see Pattern 12)
3. `guest_count` guard: provided and < 1 → 400
4. Room SELECT: `SELECT id, capacity FROM bookings.rooms WHERE id=$1 AND tenant_id=$2`
5. Capacity ceiling: `guest_count > room.capacity` → 400 (skipped if `capacity = 0`)
6. Overlap SQL → 409 if clash found
7. INSERT: catches `23505` (unique index violation) → 409 (second race defence)

**Status enum applies to both `/bookings/create` and `/bookings/update`.**

**Migration 022** (`022_confirmed_bookings_unique_slot.sql`) — unique partial index on
`(room_id, booking_date, start_time, end_time) WHERE status <> 'cancelled'`.
Closes TOCTOU race at the DB layer. Next migration number: `028`.
