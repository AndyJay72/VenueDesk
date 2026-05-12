# VenueDesk Migration Status & Roadmap
**Date:** 2026-05-12  
**Phase:** 4b Ready — All prerequisites met, FORCE RLS next  
**Classification:** Internal Engineering Reference

---

## 1. Executive Summary

VenueDesk has completed Phase 3 of the CLAUDE.md architectural migration. The system now operates under a **db-api-exclusive** data access model:

```
Browser / n8n
     │ JWT
     ▼
  db-api  (Fastify + auth middleware)
     │ SET LOCAL app.tenant_id
     ▼
 PostgreSQL  (RLS ENABLED, FORCE pending)
```

**db-api** (`https://api.venuedesk.co.uk`) is the exclusive gatekeeper for all SQL execution. n8n has been reduced to an orchestration layer — HTTP calls only. The PostgreSQL database has Row-Level Security **enabled** on all tenant-scoped tables but **not yet forced**, pending the SQL purge of the remaining in-scope workflows documented in §4.

### Current architectural guarantees
| Guarantee | Status |
|-----------|--------|
| No SQL in frontend | ✅ Complete |
| No SQL in n8n (core booking flows) | ✅ Complete |
| JWT required on all db-api endpoints | ✅ Complete |
| Tenant isolation via JWT payload | ✅ Complete |
| RLS ENABLE on all tenant tables | ✅ Complete |
| RLS FORCE (zero-bypass enforcement) | ⏳ Ready to execute — see §5 |

---

## 2. Problems & Solutions — The War Room History

### 2.1 The Handshake Failure — Broken Cycle Seeding

**Symptom:** New recurring series were created but the first billing cycle record was never written. The dashboard showed a live series with a `£0` outstanding balance and no payment schedule entry, making chaser automation permanently blind to the first payment.

**Root cause:** The `create-series` endpoint only inserted the `recurring_series` parent row. The N+1 billing cycle seed (cycle 1 with `balance_due = cycle_amount`) was the caller's responsibility — but `CreateRecurringBooking.json` called `create-series` and then immediately called `insert-bookings` without ever seeding the schedule.

**Fix:** The `record-payment` endpoint in `recurring.js` was extended to handle the N+1 cycle handshake. When `is_first_cycle: true` is passed, it:
1. Inserts the next cycle row into `recurring_payment_schedule`
2. Sets `balance_due = cycle_amount` on the parent `recurring_series`
3. Commits atomically — no partial state possible

---

### 2.2 The 25P02 Aborts — Broken Transactions After Errors

**Symptom:** Any query that followed a caught exception inside a `withTenantContext` block would fail with:
```
error: current transaction is aborted, commands ignored until end of transaction block
```

**Root cause:** PostgreSQL aborts the entire transaction on any error. When a route handler caught an exception internally and continued, the next query ran in an aborted transaction context — rejected immediately regardless of SQL correctness.

**Fix (CLAUDE.md Pattern 2):** `withTenantContext` was updated to use `SAVEPOINT` isolation. Sub-operations that may fail are wrapped in savepoints:
```javascript
await client.query('SAVEPOINT sp1');
try {
  await client.query(riskySQL, params);
  await client.query('RELEASE SAVEPOINT sp1');
} catch (err) {
  await client.query('ROLLBACK TO SAVEPOINT sp1');
  // continue safely — outer transaction is still live
}
```
The outer `BEGIN / COMMIT` transaction remains intact; only the savepoint rolls back.

---

### 2.3 The n8n Environment Block — $env.N8N_SERVICE_JWT Resolving to Empty

**Symptom:** After importing the HTTP-only `hBclMCxbgmz7f3Za.json`, the staff dashboard showed all-zero metrics and empty lists. Direct `curl` to `api.venuedesk.co.uk/dashboard/metrics` returned live data (`2 pending, £215 revenue`). A POST to the n8n webhook returned `404 — not registered for POST`.

**Root causes (two separate faults):**

1. **Environment block:** n8n's default for `N8N_BLOCK_ENV_ACCESS_IN_NODE` is `true`, which prevents `$env.*` expressions from resolving inside workflow nodes. `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` was present in `docker-compose.yml` but the container had never been force-recreated to pick it up. `docker-compose up -d` is a no-op when the container is already running.

   **Fix:** `docker-compose up -d --force-recreate n8n` — confirmed via `docker exec n8n_postgres-n8n-1 env | grep N8N_BLOCK_ENV`.

2. **Webhook method default:** Six webhook nodes in `hBclMCxbgmz7f3Za.json` had no `httpMethod` parameter. n8n defaults unspecified methods to `GET`; the frontend calls all of them via `POST`. Result: every dashboard fetch returned `{"code":404,"message":"This webhook is not registered for POST requests"}`, caught silently by the frontend's bare `catch` block.

   **Fix:** All 9 webhook nodes in `hBclMCxbgmz7f3Za.json` now carry explicit `"httpMethod": "POST"`.

---

### 2.4 The Legacy Purge — Removing Postgres Nodes from n8n

**Symptom (pre-migration):** n8n workflows contained Postgres nodes executing raw SQL with manual `tenant_id` filtering. This bypassed all API-layer validation, made tenant isolation application-level only, and blocked RLS FORCE adoption.

**Approach:**
- Workflows were audited programmatically for `n8n-nodes-base.postgres` node type.
- SQL was extracted and mapped to purpose-built db-api endpoints.
- Postgres nodes were replaced with `n8n-nodes-base.httpRequest` nodes using `Authorization: Bearer $env.N8N_SERVICE_JWT` (server-to-server; no CORS constraint per CLAUDE.md Pattern 4).
- The **flatten adapter pattern** was used wherever downstream nodes referenced a Postgres node by name: a Code node with the same name returns `resp.data || resp`, preserving all `$('Node Name').first().json.field` references without touching Validate or Respond nodes.

**Service authentication:** A dedicated `N8N_SERVICE_JWT` (role: `service`, tenant_id: 1001, no expiry) was generated and injected into the n8n container environment. The `CHASER_SERVICE_JWT` (role: `service`, exp: 1y) is used by the PaymentChaser scheduled workflow.

---

## 3. Completed Milestones

| # | Milestone | Detail |
|---|-----------|--------|
| ✅ | API handshake for N+1 billing cycles | `record-payment` seeds next cycle atomically on `is_first_cycle: true` |
| ✅ | Migration of Complete System API | `hBclMCxbgmz7f3Za.json` — 0 PG nodes, 13 HTTP nodes, all webhooks explicit POST |
| ✅ | Migration of Staff Login | `B1NXZMSxwOD6bDHB.json` — IF node upgraded to typeVersion 2 boolean comparator |
| ✅ | Migration of CreateRecurringBooking | 8 PG → 0 PG; flatten adapters preserve downstream references |
| ✅ | Migration of CreateRecurringFromCalendar | 9 PG → 0 PG; `create-series-calendar` endpoint handles full calendar flow |
| ✅ | Atomic series cancellation | `cancel-series-atomically` endpoint rolls back all child bookings in one transaction |
| ✅ | RLS ENABLE on all 12 tenant tables | Migration `011_rls_phase4.sql`; safe-failure design (`current_setting(…, TRUE)` returns NULL not error) |
| ✅ | Environment injection for n8n service auth | `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` confirmed live; `N8N_SERVICE_JWT` verified in container |
| ✅ | PaymentChaser — HTTP-only | `CHASER_SERVICE_JWT` injected; zero PG nodes |
| ✅ | Recurring payment lifecycle | `record-payment`, `cancel-series`, `get-schedule`, `get-outstanding`, `log-interaction` all live on db-api |
| ✅ | Dirty Ten fully migrated | All 10 in-scope workflows confirmed at 0 PG nodes (audit: 2026-05-12) |
| ✅ | `audit_log` RLS enabled + FORCED | Migration `015_audit_log_rls.sql` applied |
| ✅ | `tenants` RLS policy applied | Migration `016_tenants_rls_policy.sql` — fixes stripe/config empty response |
| ✅ | Stripe integration live | `/stripe/config`, `/stripe/session`, `/stripe/public-session`, `/stripe/webhook` all operational |
| ✅ | `POST /audit/log` db-api endpoint | Replaces `LogPaymentActionWF.json` direct PG node; `index.html` updated |

---

## 4. The "Dirty Ten" — ✅ COMPLETE

Audit run 2026-05-12 confirms all 10 in-scope workflows are at **0 PG nodes**:

| Workflow | File | PG Nodes |
|----------|------|----------|
| Billing Cycle Daily Trigger | `BillingCycleTrigger.json` | ✅ 0 |
| Cancel Booking (Series Support) | `CancelBooking.json` | ✅ 0 |
| Record Recurring Payment | `RecordRecurringPayment.json` | ✅ 0 |
| Recurring Auto-Cancel Unpaid | `RecurringAutoCancel.json` | ✅ 0 |
| Recurring Make Booking | `RecurringMakeBooking.json` | ✅ 0 |
| Services API | `ServicesWF.json` | ✅ 0 |
| Pending Lifecycle Scheduler | `XKKG5SZ75bHg35Zt.json` | ✅ 0 |
| Monthly Recurring Booking Generator | `RecurringBookingGenerator.json` | ✅ 0 |
| Create Recurring Booking (Fixed) | `RecurringBookingWorkflow_fixed.json` | ✅ 0 |
| Test: Recurring Series Architecture | `Test_RecurringSeries.json` | ✅ Deleted |

**All Phase 4b prerequisites are met. RLS FORCE execution is unblocked.**

### 4.1 Excluded — Do not migrate for FORCE RLS purposes

| Category | Workflows | Reason |
|----------|-----------|--------|
| Migration scripts | `Migration007–010.json`, `Migration_RecurringSeries.json` | DDL by design; decommission after RLS FORCE is live |
| Out-of-scope apps | Leads, Prospects, AI Generator, Virtual Tutor, Onboarding Manager, etc. | Separate product domains; not subject to VenueDesk RLS mandate |

---

## 5. Phase 4b Roadmap — The Vault Lockdown

### Prerequisites (must be true before any FORCE command)

- [x] All ten in-scope workflows reach 0 PG nodes
- [x] `Test_RecurringSeries.json` deleted from n8n and removed from backup
- [x] All migrated workflows imported and smoke-tested in n8n
- [x] Each db-api endpoint verified with real bookings data (not just health check)

### FORCE RLS Execution Order

Apply one table at a time. Verify after each step before proceeding.

| Step | Table | Command | Verification query |
|------|-------|---------|-------------------|
| 1 | `customers` | `ALTER TABLE bookings.customers FORCE ROW LEVEL SECURITY;` | `SELECT COUNT(*) FROM bookings.customers;` — should return tenant row count, not 0 |
| 2 | `confirmed_bookings` | `ALTER TABLE bookings.confirmed_bookings FORCE ROW LEVEL SECURITY;` | Dashboard upcoming bookings still populate |
| 3 | `booking_requests` | `ALTER TABLE bookings.booking_requests FORCE ROW LEVEL SECURITY;` | Enquiry submission + pending list functional |
| 4 | `payments` | `ALTER TABLE bookings.payments FORCE ROW LEVEL SECURITY;` | Revenue metrics non-zero |
| 5 | `recurring_series` | `ALTER TABLE bookings.recurring_series FORCE ROW LEVEL SECURITY;` | Recurring dashboard loads |
| 6 | `recurring_rules` | `ALTER TABLE bookings.recurring_rules FORCE ROW LEVEL SECURITY;` | Booking creation + calendar functional |
| 7 | `recurring_payment_schedule` | `ALTER TABLE bookings.recurring_payment_schedule FORCE ROW LEVEL SECURITY;` | PaymentChaser smoke test passes |
| 8 | `payments` (outstanding) | — (already done in step 4) | — |
| 9 | `customer_interactions` | `ALTER TABLE bookings.customer_interactions FORCE ROW LEVEL SECURITY;` | Interactions log loads |
| 10 | `audit_logs` | `ALTER TABLE bookings.audit_logs FORCE ROW LEVEL SECURITY;` | No errors in API logs |
| 11 | `rooms` | `ALTER TABLE bookings.rooms FORCE ROW LEVEL SECURITY;` | Room picker in booking form functional |
| 12 | `add_on_services` | `ALTER TABLE bookings.add_on_services FORCE ROW LEVEL SECURITY;` | Services endpoint returns data |

**Do NOT FORCE:** `bookings.staff_users` (login path requires cross-tenant lookup), `bookings.tenants` (cross-tenant onboarding by design).

### Rollback (if any step breaks production)

```sql
ALTER TABLE bookings.<table> DISABLE ROW LEVEL SECURITY;
```

Rollback is instant and non-destructive. Re-enable after diagnosing the failing workflow.

### Tenant context injection — mandatory pattern (CLAUDE.md Pattern 2)

Every db-api route that touches a FORCE-RLS table must call `withTenantContext` before any query:

```javascript
// CLAUDE.md Pattern 2 — use set_config(), NOT parameterised SET LOCAL
await client.query(
  "SELECT set_config('app.tenant_id', $1, true)",
  [request.user.tenant_id.toString()]   // must be string; true = transaction-scoped
);
```

`request.user.tenant_id` is populated exclusively from the verified JWT payload (CLAUDE.md §3.3 — never from request body).

---

## 6. Architecture Reference

```
┌─────────────────────────────────────────────────────┐
│  Browser (GitHub Pages)                             │
│  fetch POST → n8n webhooks (no auth header, JWT    │
│               embedded in JSON body — Pattern 4)   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  n8n  (orchestration only — zero SQL)               │
│  HTTP nodes → Authorization: Bearer $env.N8N_SERVICE_JWT
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  db-api  (Fastify, api.venuedesk.co.uk)             │
│  ├─ authenticate middleware → verifies JWT signature│
│  ├─ extracts tenant_id from JWT payload only        │
│  └─ withTenantContext → set_config(app.tenant_id)  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  PostgreSQL  (schema: bookings)                     │
│  RLS ENABLE on 12 tables — FORCE pending Phase 4b  │
│  Tenant isolation: tenant_id = app.tenant_id::int  │
└─────────────────────────────────────────────────────┘
```

---

*Generated: 2026-04-28 | Updated: 2026-05-12 | Next action: execute FORCE RLS rollout (§5)*
