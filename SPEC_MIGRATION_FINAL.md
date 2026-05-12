# VenueDesk — Migration Final Specification
## Phase 2 → Phase 4 Complete Reference

> **Status**: Phase 2 (db-api) ✅ | Phase 3 (JWT) ✅ | Phase 4 (RLS) 🔄 In Progress  
> **Last Updated**: 2026-04-27  
> **Architecture Version**: v2.0.0

---

## 1. Architecture Overview

```
Browser / n8n
     │
     │  JWT (Bearer header OR body.jwt tunnel)
     ▼
 db-api  (Fastify, Node.js — api.venuedesk.co.uk)
     │  withTenantContext → set_config('app.tenant_id', tenantId, true)
     ▼
 PostgreSQL  (bookings schema — RLS enforced)
     │
     └── n8n (orchestration ONLY — zero SQL)
```

**Golden Rule**: SQL lives exclusively in `db-api/src/routes/*.js`. n8n workflows contain
zero Postgres nodes. The database is the last physical enforcement layer.

---

## 2. Auth Contract

### 2.1 Token Structure

Every user token (HS256, 60-minute expiry):
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "username": "string",
  "role": "admin | staff",
  "full_name": "string",
  "tenant_id": 1001,
  "iat": 1700000000,
  "exp": 1700003600
}
```

Service tokens (scheduler / chaser — no expiry):
```json
{
  "id": "n8n-service",
  "user_id": "n8n-service",
  "role": "service",
  "tenant_id": 1001,
  "iat": 1700000000
}
```

### 2.2 Token Extraction (Pattern 4 — JWT Body-Tunnel)

Browsers cannot send `Authorization` headers cross-origin without a CORS preflight.
`db-api` accepts the JWT from **two sources** in every request:

```javascript
// auth.js middleware — priority: header > body
const headerRaw = (request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
const bodyRaw   = request.body?.jwt || '';
const rawToken  = headerRaw || bodyRaw;
```

**Frontend** always embeds `jwt: sessionStorage.getItem('vp_token')` in POST bodies.  
**n8n HTTP nodes** always send `Authorization: Bearer <token>` in headers.

### 2.3 Middleware Enforcement

```javascript
// auth.js — required claims validation
const { user_id, id, tenant_id, role } = request.user;
const isService = role === 'service';
if (!effectiveUserId || !role)           → 401 UNAUTHORIZED
if (!isService && tenant_id == null)     → 401 UNAUTHORIZED
```

### 2.4 sessionStorage Contract (Frontend)

All dashboard pages read these keys — login MUST set all five:

| Key           | Source                              | Used for                    |
|---------------|-------------------------------------|-----------------------------|
| `vp_token`    | `data.token`                        | JWT body-tunnel in POST     |
| `vp_tenant_id`| `data.user.tenant_id`               | Tenant isolation in queries |
| `vp_user_name`| `data.user.full_name`               | `staff_member` field        |
| `vp_venue_name`| `data.user.full_name`              | Sidebar display name        |
| `vp_user`     | `JSON.stringify(data.user)`         | Full user context           |

---

## 3. Tenant Context Contract

### 3.1 withTenantContext (user-facing routes)

```javascript
// pool.js — ALL tenant-scoped queries must run inside this
async function withTenantContext(tenantId, fn) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
  const result = await fn(client);
  await client.query('COMMIT');
  return result;
}
```

**Critical**: `SET LOCAL app.tenant_id = $1` is invalid SQL — PostgreSQL's SET command
does not accept parameterised values. Always use `set_config()` (Pattern 2).

### 3.2 withServiceContext (scheduler / cross-tenant)

Service-role routes bypass tenant scoping but must include explicit `WHERE tenant_id IN (...)`:
```javascript
async function withServiceContext(fn) {
  // No set_config call — RLS policies will return 0 rows if triggered
  // Service routes must filter explicitly
}
```

### 3.3 onboarding routes (super-admin, raw pool)

`/onboarding/*` uses raw `pool.query()` directly — these are cross-tenant by design
and authenticated via `X-Admin-Key` (not JWT). The `venuedesk` DB user must be the
table owner (or have BYPASSRLS) for these routes to work under FORCE RLS.

---

## 4. Billing Contract

### 4.1 N+1 Seeding Handshake

When `POST /recurring/record-payment` is called and `remaining_cycles` drops to 0,
the endpoint automatically seeds the next billing cycle via `POST /recurring/seed-lifecycle-schedule`.
This is the "N+1 Handshake" — payment recording and schedule seeding are atomic within
one `withTenantContext` transaction.

### 4.2 Payment Architecture

```
Frontend → POST /recurring/record-payment
  └── 1. Resolve series_id (supports both recurring_series UUID and recurring_rule_id)
  └── 2. Reduce recurring_series.balance_due by amount
  └── 3. INSERT bookings.payments (payment_type='recurring_session')
  └── 4. Apply to oldest unpaid sessions (cb.balance_due > 0)
  └── 5. INSERT customer_interaction log
  └── 6. INSERT audit_log
  └── 7. If remaining_cycles → 0: seed next cycle (N+1 Handshake)
```

### 4.3 Cancel-Series Refund Calculation

```sql
-- Refund = total paid - (sessions_delivered × per_session_rate)
-- sessions_delivered = COUNT confirmed_bookings WHERE status NOT IN ('cancelled')
--                      AND booking_date < CURRENT_DATE
```

---

## 5. Security Contract

### 5.1 Non-Negotiable Rules

| Rule | Enforcement |
|------|-------------|
| No SQL in n8n | Architecture — n8n uses only HTTP nodes |
| tenant_id from JWT only | auth.js middleware rejects body tenant_id |
| All DB calls through db-api | n8n PG credential removed (Phase 4 target) |
| Tenant isolation database-enforced | RLS policies on all bookings.* tables |

### 5.2 CORS / Header Strategy

`getAuthHeaders()` returns `{}` on the frontend. Tenant context travels via:
- **GET requests**: `?tenant_id=<id>` query parameter
- **POST requests**: `tenant_id` field in JSON body (for n8n compatibility only)
- **JWT**: always via `body.jwt` (browser) or `Authorization` header (n8n/server)

**Actual tenant_id used in queries** always comes from `request.user.tenant_id` (JWT) —
never from `request.body.tenant_id`.

---

## 6. Patterns Learned (Phase 2/3 Production Failures)

### Pattern 1 — JWT Integrity (Hollow Token Prevention)
n8n `JWT: Sign` with `claims: {}` produces tokens with only `iat`.
**Always** explicitly map all claims: `id`, `username`, `role`, `full_name`, `tenant_id`.

### Pattern 2 — set_config() for Tenant Injection
`SET LOCAL app.tenant_id = $1` is a syntax error in `pg`. Use:
```javascript
await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId.toString()]);
```

### Pattern 3 — 42P08 Parameter Type Safety
Using the same `$N` parameter in two type contexts (e.g., VARCHAR column and `|| $N::text`)
causes `ERROR 42P08: inconsistent types`. Build composite strings in JS before passing.

### Pattern 4 — JWT Body-Tunnel
Browsers block `Authorization` headers on cross-origin requests. Embed token as `body.jwt`.

### Pattern 5 — Docker Build Cache Bypass
`docker-compose build --no-cache` still uses BuildKit cache for unchanged files.
Use `docker cp` to inject files directly into running containers; restart after.

### Pattern 6 — N8N_BLOCK_ENV_ACCESS_IN_NODE
n8n v2.16.1 blocks `$env.*` by default. Must set:
```yaml
N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"
```
in the n8n service environment block in `docker-compose.yml`.

### Pattern 7 — SER-INIT Labeling
Service-role scheduler workflows that perform N+1 seeding must log
`[SER-INIT]` prefix in audit notes to distinguish system-generated actions from
user-initiated ones in `customer_interactions`.

---

## 7. Phase 4 — Row-Level Security Rollout

### 7.1 RLS Policy Design

```sql
-- Standard tenant isolation policy (applied to all tenant-scoped tables)
CREATE POLICY tenant_isolation_policy ON bookings.<table>
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::int);
```

The `true` parameter in `current_setting('app.tenant_id', true)` returns NULL instead
of throwing an error when the setting is not set — causing queries to return 0 rows
rather than erroring. This is the "safe failure" mode required by CLAUDE.md.

### 7.2 Tables — RLS Rollout Order

| Table | ENABLE | FORCE | Risk | Notes |
|-------|--------|-------|------|-------|
| `bookings.customers` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.confirmed_bookings` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.booking_requests` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.payments` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.recurring_series` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.recurring_rules` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.customer_interactions` | ✅ | ✅ | Low | All routes use withTenantContext |
| `bookings.recurring_payment_schedule` | ✅ | ✅ | Low | Legacy arch, still queried |
| `bookings.outstanding_payments` | ✅ | ✅ | Low | Billing cycle tables |
| `bookings.staff_users` | ✅ | ⚠️ | Medium | Login queries by username before tenant_id known — needs BYPASSRLS on venuedesk role OR flexible policy |
| `bookings.tenants` | ✅ | ⛔ | High | Cross-tenant by design — onboarding uses raw pool |
| `bookings.rooms` | ✅ | ✅ | Low | Tenant-scoped |
| `bookings.audit_logs` | ✅ | ✅ | Low | Append-only via withTenantContext |

### 7.3 Pre-FORCE Checklist

Before running `ALTER TABLE ... FORCE ROW LEVEL SECURITY`:

- [ ] All n8n workflows using direct PG nodes on this table have been replaced with HTTP calls
- [ ] `withTenantContext` is called in every route handler that touches this table
- [ ] Service-role routes use `withServiceContext` + explicit `WHERE tenant_id` filters
- [ ] Login route (`/auth/login`) verified to work with staff_users policy
- [ ] Zero-tenant test: `curl` the endpoint without JWT — confirm 0 rows returned

### 7.4 FORCE RLS Pre-Requisite: Remaining Dirty Workflows

The following n8n workflows still contain direct Postgres nodes that **will silently
return 0 rows** once FORCE RLS is enabled. They MUST be migrated before FORCE:

| Workflow | PG Nodes | Priority |
|----------|----------|----------|
| `CreateRecurringBooking.json` | 8 | HIGH — user-facing |
| `CreateRecurringFromCalendar.json` | 9 | HIGH — user-facing |
| `RecordRecurringPayment.json` | 6 | HIGH — payment recording |
| `CancelBooking.json` | 5 | HIGH — user-facing |
| `BillingCycleTrigger.json` | 6 | HIGH — daily cron |
| `RecurringMakeBooking.json` | 5 | HIGH — user-facing |
| `RecurringAutoCancel.json` | 5 | MEDIUM — daily cron |
| `RecurringPaymentReminder.json` | 2 | MEDIUM — daily cron |
| `RecurringBookingWorkflow_fixed.json` | 4 | LOW — duplicate |
| `RecurringPaymentOverride.json` | 2 | LOW — admin tool |
| `UpdateRecurringRule.json` | 2 | LOW — admin tool |

**Safe to ignore (non-VenueDesk)**: Education platform workflows (`HgA9JOnX1vsDYaED`,
`kjiwnkYPOsmVt2w2`, `mxDwUMJ4LvfvTcKK`, `u889Fz8HrurdqW9v`), leadgen workflows
(`BjHe6jnpWTYOcPS3`, `EditLeadWF`, `ElZJaflNkUL51zbk`, `LeadsUpdateWF`,
`ProspectsGetWF`, `Wl4HBw8sGpfvTzta`, `XZAZP8vd6PxIdmj9`).

**Safe to archive (DDL already run)**: `Migration007-010.json`, `Migration_RecurringSeries.json`.

**Safe to delete (test/dead code)**: `Test_RecurringSeries.json`, `RecurringBookingGenerator.json`
(references `bookings.membership_invoices` and `bookings.membership_policies` — tables
that do not exist in the current schema).

---

## 8. Infrastructure Reference

| Service | URL / Location |
|---------|----------------|
| n8n UI | https://n8n.srv1090894.hstgr.cloud |
| db-api | https://api.venuedesk.co.uk |
| Frontend | https://andyjay72.github.io/VenueDesk |
| GitHub | https://github.com/AndyJay72/VenueDesk |
| VPS IP | 72.61.19.52 |
| docker-compose | `/opt/n8n_postgres/docker-compose.yml` |
| db-api container | `venuedesk-api` |
| n8n compose service | `n8n` |

### Deploy API changes
```bash
scp ~/Downloads/venue_desk_backup/venuedesk-api/src/routes/<file>.js \
    root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/
ssh root@72.61.19.52 \
  "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js \
              venuedesk-api:/app/src/routes/<file>.js && docker restart venuedesk-api"
```

### Deploy frontend
```bash
cd ~/Downloads/venue_desk_backup
git add CommunityHub/<file>.html
git commit -m "..."
git push origin main
```

---

## 9. Migration State Summary

| Phase | Status | Key Deliverable |
|-------|--------|-----------------|
| Phase 1 — db-api layer | ✅ Complete | `venuedesk-api` Fastify service, all core routes |
| Phase 2 — n8n → HTTP | 🔄 ~70% | 28+ workflows rewritten; 11 complex ones remain |
| Phase 3 — JWT auth | ✅ Complete | `auth.js` middleware, `@fastify/jwt`, service tokens |
| Phase 3b — Billing Handshake | ✅ Complete | `record-payment` N+1 seeding, `recurring_series` arch |
| Phase 4a — RLS ENABLE | 🔄 Ready | Migration `011_rls_phase4.sql` written |
| Phase 4b — RLS FORCE | ⏳ Blocked | Requires Phase 2 completion on 11 remaining workflows |
