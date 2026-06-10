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
| `/config` | `config.js` | Rooms, event types, pricing, settings |
| `/customers` | `customers.js` | CRM — upsert, update, list, interactions |
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

### Correct concurrency approach:

Use a DB-level unique constraint + `ON CONFLICT` at INSERT time. This is atomic and RLS-compatible. **Pending migration 022** (see parent CLAUDE.md Pending Items).

---

## Migration System

Migrations live in `src/db/migrations/` and run automatically on container start via `src/db/migrate.js`.

**Adding a migration:**
1. Create `src/db/migrations/022_description.sql`
2. Write idempotent SQL (`IF NOT EXISTS`, `DO $$ IF NOT EXISTS ... $$`)
3. SCP to VPS + docker cp + `docker restart venuedesk-api`

**Naming:** Files run in lexicographic order. Use `0NN_` prefix. Never renumber existing files — the runner tracks executed migrations by filename.

**Latest migration:** `021_payments_payment_type_cycle.sql`  
**Next number:** `022`

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
| 3c Historical date | Accepted (200) | No past-date guard (pending) |
| 3d 3-year span | Accepted (200) | No max-duration ceiling (pending) |
| 5a Double-cancel | Skipped ("?") | Test 3d's 3-year booking overlaps 2027-01-10; test ordering artefact |
| 6a/6b Race | All timeout (0) | Test 3d booking also overlaps 2027-03-01; 5 threads get 409 instantly, harness misreads as TCP timeout |
| 7a No-auth header | 400 not 401 | Test script POSTs to a GET endpoint; 400 is correct |

**Baseline (June 2026):** 34 PASS · 0 CRITICAL · 5 FAIL (all known limitations) · 1 SKIP

---

## /bookings/create — Field Reference

| Field | Required | Schema type | Validation |
|-------|----------|-------------|------------|
| `customer_id` | ✓ | string | assertUUID |
| `room_id` | ✓ | string | assertUUID |
| `booking_date` | ✓ | string | PG DATE cast |
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
1. Room SELECT (capacity lookup)
2. Handler guest_count capacity ceiling check → 400 if exceeded
3. Overlap SQL → 409 if clash found
4. INSERT with guest_count column included

**Status enum applies to both `/bookings/create` and `/bookings/update`.**
