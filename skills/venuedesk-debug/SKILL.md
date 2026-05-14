---
name: venuedesk-debug
description: >
  Diagnose and fix issues in the VenueDesk/VenuePro booking CRM — a system built on
  n8n webhooks, PostgreSQL, and vanilla-JS frontend pages. Use this skill whenever
  the user reports: CORS errors, 403 authentication failures, blank pages, data not
  loading, "Save failed" / "Load failed" / "Submission failed" errors, wrong tenant data,
  missing endpoints, broken n8n workflows, pending requests list empty while scorecard
  shows a count, availability check errors, or anything relating to the files in
  venue_desk_backup/CommunityHub/ or venue_desk_backup/n8n-workflows/.
  Also invoke for proactive audits: "check all my workflows", "why is X not showing data",
  "something is wrong with the calendar / accounts / dashboard / enquiry form".
---

# VenueDesk Debug & Fix Skill

VenueDesk is a small-venue booking CRM. The stack is:
- **Frontend**: Static HTML pages in `venue_desk_backup/CommunityHub/` — `index.html` (main dashboard), `calendar.html`, `accounts.html`, `leadgen-dashboard.html`, `enquiry-form-2.html`
- **Backend**: n8n webhooks at `https://n8n.srv1090894.hstgr.cloud/webhook/<path>`
- **Database**: PostgreSQL, schema `bookings`, tenant-isolated by `tenant_id = 1001`
- **Auth**: Session stored in `sessionStorage` (`vp_token`, `vp_tenant_id`, `vp_user_name`)

---

## Diagnostic Checklist

Before writing a single line of code, gather these facts:

1. **What is the error?** (Console message, network tab status code, UI text)
2. **Which frontend page / function?** (Which HTML file, which JavaScript function)
3. **Which n8n workflow / webhook path?** (Search workflow files for the URL slug)
4. **What does the workflow expect?** (header auth? query param? body field?)

Use these as your primary investigation tools:
```bash
# Find which workflow owns a webhook path
grep -rl "<webhook-path>" /path/to/n8n-workflows/

# List all webhook paths in all workflows
python3 -c "
import json, glob
for f in glob.glob('n8n-workflows/*.json'):
    d = json.load(open(f))
    paths = [n.get('parameters',{}).get('path','') for n in d.get('nodes',[]) if 'webhook' in n.get('type','').lower()]
    if any(paths): print(f, '->', [p for p in paths if p])
"

# Find all fetch() calls in a frontend file
grep -n "fetch(" CommunityHub/index.html

# Trace a workflow's full execution chain
python3 -c "
import json
d = json.load(open('workflow.json'))
conns = d['connections']
def trace(start, depth=0):
    targets = [c['node'] for c in conns.get(start,{}).get('main',[[]])[0]]
    print('  '*depth + start)
    [trace(t, depth+1) for t in targets]
trace('Webhook: Name')
"
```

---

## Root Cause Patterns (Fix These First)

### Pattern 1 — CORS Preflight Failure ("Load failed" / "Failed to fetch")

**Symptom**: Network request is blocked before it reaches n8n. Browser console shows CORS error. JS catch block receives a TypeError, not an HTTP error — so error message is "Load failed" (Safari) or "Failed to fetch" (Chrome).

**Cause**: Custom request headers (`Authorization`, `X-Tenant-ID`, `X-Venue-ID`) trigger a CORS preflight `OPTIONS` request. n8n's built-in CORS response does not include custom header names in `Access-Control-Allow-Headers`, so the browser blocks the actual request.

**Fix in frontend**: `getAuthHeaders()` must return `{}`. Tenant ID travels via query param on GET calls and JSON body on POST calls — never as a header.

```javascript
// CORRECT
function getAuthHeaders() { return {}; }
function _TID() { return sessionStorage.getItem('vp_tenant_id') || '0'; }
function tidParam(sep='?') { return sep + 'tenant_id=' + _TID(); }

// GET calls
fetch(SOME_URL + tidParam(), { headers: getAuthHeaders() })
fetch(SOME_URL + '?month=1&year=2025' + tidParam('&'), { headers: getAuthHeaders() })

// POST calls — add tenant_id to the JSON body
body: JSON.stringify({ customer_id: id, full_name: name, tenant_id: parseInt(_TID()) })
```

**Scope — do NOT homogenise frontend and server-to-server patterns.** This rule applies
to **browser → db-api / browser → n8n** fetches only. n8n HTTP Request nodes that call
db-api (e.g. `DB: Set Booking Confirmed`, `DB: Create Booking From Request`,
`DB: Create Booking`) **should** keep their `Authorization: Bearer ...` headers — there
is no browser on that hop, no CORS preflight, and the db-api auth middleware prefers the
header path. A common regression: during a "tidy-up pass" someone strips Authorization
from every workflow node thinking it's the same rule. It isn't. Server-to-server
n8n → db-api calls **break** without the header because `$json`-constructed bodies in
HTTP Request nodes don't reliably surface as `body.jwt` for the middleware fallback.

| Caller                  | Auth method                 | Reason                              |
|-------------------------|-----------------------------|-------------------------------------|
| Browser fetch()         | `body.jwt` / `?jwt=...`     | CORS blocks custom headers          |
| n8n HTTP Request node   | `Authorization: Bearer ...` | Server-to-server, no preflight      |
| curl / Postman          | `Authorization: Bearer ...` | No browser involved                 |

Quick mental model: **CORS is a browser concept.** If the caller isn't a browser,
the body-tunnel rule doesn't apply.

---

### Pattern 2 — 403 from n8n headerAuth ("HTTP 403" error)

**Symptom**: Fetch succeeds (no CORS block) but returns 403.

**Cause**: The n8n webhook node has `"authentication": "headerAuth"` pointing to a credential that stores a fixed API key. The frontend sends `Authorization: Bearer <jwt>` — these never match.

**Fix in workflow JSON**: Remove `authentication` from every webhook node. The `credentials` block for the webhook should be empty `{}`.

```json
// BEFORE (broken)
{
  "parameters": { "authentication": "headerAuth", ... },
  "credentials": { "headerAuth": { "id": "GpsgXYuDnU6Em9cm", "name": "VenuePro Dashboard Auth" } }
}

// AFTER (correct)
{
  "parameters": { "authentication": "none", ... },
  "credentials": {}
}
```

To patch all webhooks in a workflow file at once:
```python
import json

with open('workflow.json') as f:
    d = json.load(f)

for node_list_key in ['nodes', 'activeVersion']:
    nodes = d.get(node_list_key, {})
    if isinstance(nodes, dict):
        nodes = nodes.get('nodes', [])
    for n in nodes:
        if 'webhook' in n.get('type', '').lower():
            n['parameters']['authentication'] = 'none'
            n['credentials'] = {}

with open('workflow.json', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
```

> **Important**: n8n workflow files have TWO places where nodes are stored — the top-level `nodes` array AND `activeVersion.nodes`. Both must be patched, or the live running version will be unchanged after re-import.

---

### Pattern 3 — Wrong `$json` Reference in n8n (empty results / silent failures)

**Symptom**: A query seems to run but returns no rows. No error. Data is just absent. Often caused by `tenant_id` evaluating to `0`.

**Cause**: In a multi-node n8n chain, `$json` inside a Postgres node refers to the output of the *immediately preceding node* — not the original webhook. If there's a Code node or another Postgres node between the webhook and the DB node, `$json.query?.tenant_id` will look for `tenant_id` on that intermediate node's output, which won't have it.

**Fix**: Always explicitly name the source node in expressions:

```
// BROKEN — $json is the output of the previous Code/DB node
parseInt($json.headers?.['x-tenant-id'] || $json.query?.tenant_id || '0')

// CORRECT — explicitly references the webhook node by name
parseInt($('Webhook: Accounts').first().json.headers?.['x-tenant-id'] || $('Webhook: Accounts').first().json.query?.tenant_id || '0')
```

When tenant_id now travels via query param (not header), also ensure the expression checks `query?.tenant_id`. For POST calls where tenant_id is in the body, check `body?.tenant_id` too:

```
parseInt(input.tenant_id || $input.first().json.headers?.['x-tenant-id'] || $input.first().json.query?.tenant_id || '0')
```

---

### Pattern 4 — Missing Webhook Endpoint ("HTTP 404" or "Load failed" with no matching workflow)

**Symptom**: Frontend calls e.g. `POST /webhook/update-customer` but no workflow contains that path.

**Diagnosis**:
```bash
grep -rl "update-customer" n8n-workflows/   # returns nothing = endpoint doesn't exist
```

**Fix**: Create a minimal new workflow JSON. Template:

```json
{
  "name": "VenuePro - [Descriptive Name]",
  "nodes": [
    {
      "parameters": { "httpMethod": "POST", "path": "update-customer", "authentication": "none", "responseMode": "responseNode", "options": {} },
      "id": "wh-001", "name": "Webhook: Update Customer",
      "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-400, 200], "webhookId": "update-customer",
      "credentials": {}
    },
    {
      "parameters": {
        "operation": "executeQuery",
        "query": "UPDATE bookings.customers SET full_name = COALESCE(NULLIF($3,''),full_name), email = COALESCE(NULLIF($4,''),email), phone = COALESCE(NULLIF($5,''),phone), event_type = COALESCE(NULLIF($6,''),event_type), notes = COALESCE(NULLIF($7,''),notes), updated_at = NOW() WHERE id = $1 AND tenant_id = $2;",
        "options": { "queryReplacement": "={{ [$('Webhook: Update Customer').first().json.body.customer_id, parseInt($('Webhook: Update Customer').first().json.body.tenant_id || $('Webhook: Update Customer').first().json.query?.tenant_id || '0'), $('Webhook: Update Customer').first().json.body.full_name || '', $('Webhook: Update Customer').first().json.body.email || '', $('Webhook: Update Customer').first().json.body.phone || '', $('Webhook: Update Customer').first().json.body.event_type || '', $('Webhook: Update Customer').first().json.body.notes || ''] }}" }
      },
      "id": "db-001", "name": "DB: Update Customer",
      "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [-160, 200],
      "credentials": { "postgres": { "id": "XHopEzNBCVGCXpXV", "name": "Postgres account" } }
    },
    {
      "parameters": { "respondWith": "json", "responseBody": "{\"status\":\"success\"}", "options": {} },
      "id": "re-001", "name": "Respond",
      "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [80, 200]
    }
  ],
  "pinData": {}, "active": true,
  "connections": {
    "Webhook: Update Customer": { "main": [[{"node":"DB: Update Customer","type":"main","index":0}]] },
    "DB: Update Customer": { "main": [[{"node":"Respond","type":"main","index":0}]] }
  },
  "settings": { "executionOrder": "v1" },
  "versionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "meta": { "instanceId": "549da98b647a0680fe0fcd6771d8bbf2be22efed9edc6fd9df5b8e33e8c15d93" },
  "id": "NewWorkflowXX01", "tags": []
}
```

Always save new workflows to `venue_desk_backup/n8n-workflows/` so they're alongside the others.

---

### Pattern 5 — Email/External Node Blocking the Response ("Submission failed" with DB write succeeding)

**Symptom**: The user submits a form and gets "Submission failed" / "Please check your details". But inspecting the database shows the customer record *was* created — the DB writes are working. The workflow stops before returning a success response.

**Cause**: An email send node (or any node calling an external service — SMTP, Slack, etc.) sits in the **linear chain between the final DB write and the `respondToWebhook` node**. When n8n uses `responseMode: "responseNode"`, the HTTP response is only sent when the respond node executes. If the email node fails (SMTP not configured, network timeout, bad credentials), n8n halts the chain — the respond node never fires, so the webhook returns an error instead of success.

**How to confirm**: Trace the workflow connections. If you see:
```
DB: Create X -> Email: Send -> Respond: OK
```
...then a failing email = a failing submission, even when the data saved fine.

**Fix**: Fan the final DB write out to **both** the respond node and the email node in parallel. With `responseMode: "responseNode"`, once the respond node fires the HTTP response is sent immediately — the email then runs as fire-and-forget in the background.

```json
// BEFORE (email blocks response)
"DB: Create Request": {
  "main": [[{"node": "Email: Ack", "type": "main", "index": 0}]]
},
"Email: Ack": {
  "main": [[{"node": "Respond: OK", "type": "main", "index": 0}]]
}

// AFTER (respond fires immediately, email is non-blocking)
"DB: Create Request": {
  "main": [[
    {"node": "Respond: OK", "type": "main", "index": 0},
    {"node": "Email: Ack", "type": "main", "index": 0}
  ]]
}
// Remove the Email: Ack -> Respond: OK connection entirely
```

Patch both `connections` in top-level AND `activeVersion.connections`.

---

### Pattern 6 — $json Chain Staleness: Scorecard Right, List Empty

**Symptom**: A dashboard scorecard (e.g. "Pending Requests: 3") shows the correct count, but the actual list below it shows nothing. Refreshing doesn't help. The data is clearly in the database.

**Cause**: A specific, hard-to-spot variant of Pattern 3. In a workflow like:

```
Webhook -> DB: Metrics -> DB: Recent -> DB: Upcoming -> Code: Merge -> Respond
```

- `DB: Metrics` runs right after the webhook — its `$json.query?.tenant_id` correctly reads `tenant_id=1001` from the webhook's query params ✓
- `DB: Recent` runs after `DB: Metrics` — its `$json` is now the *metrics result object* (`{pending_requests: 3, ...}`), not the webhook. So `$json.query?.tenant_id` is `undefined` → falls to `'0'` → returns zero rows ✗

The scorecard is correct because the metrics node is first. Every node further down the chain has a stale `$json` if it relies on bare `$json.query`.

**How to spot it quickly**: Any `queryReplacement` that mixes an explicit `$('Webhook: Name')` reference for headers but a bare `$json` fallback for the query param is broken for all but the first node:

```javascript
// Looks correct but only works for the FIRST node after the webhook
$('Webhook: Dashboard').first().json.headers?.['x-tenant-id'] || $json.query?.tenant_id || '0'
//                                                                  ^^^^^ stale for node 2+
```

**Fix**: Use the explicit webhook reference for the query param in *every* node in the chain:

```javascript
// CORRECT — works anywhere in the chain
parseInt($('Webhook: Dashboard').first().json.headers?.['x-tenant-id']
      || $('Webhook: Dashboard').first().json.query?.tenant_id
      || '0')
```

Audit script to find all affected nodes in a workflow:
```python
import json
with open('workflow.json') as f:
    d = json.load(f)
for n in d.get('nodes', []):
    qr = n.get('parameters', {}).get('options', {}).get('queryReplacement', '')
    if '$json.query' in qr and "$('Webhook" not in qr:
        print(f"BROKEN: {n['name']} — uses $json.query without explicit webhook ref")
```

---

### Pattern 7 — External Table Subquery Causing Availability Failure

**Symptom**: Date/time availability check returns an error ("Could not reach availability service"), or the frontend's `.json()` throws because the response is HTML, not JSON.

**Cause**: A DB node's SQL query contains a subquery that reads from an auxiliary settings table (e.g. `bookings.settings`) to fetch a config value like `booking_buffer_minutes`. If that table or row doesn't exist, PostgreSQL throws an exception, n8n returns an HTML error page instead of JSON, and the frontend's `res.json()` call fails.

**Example of the fragile pattern**:
```sql
-- FRAGILE: fails if bookings.settings has no row for this tenant
AND (start_time < ($4::time + (
    SELECT (value::int || ' minutes')::interval
    FROM bookings.settings
    WHERE key = 'booking_buffer_minutes' AND tenant_id = $5
)))
```

**Fix**: Hardcode the value or use a `COALESCE` with a safe default so a missing row never causes a failure:
```sql
-- SAFE: hardcoded fallback
AND (start_time < ($4::time + interval '60 minutes'))

-- ALSO SAFE: COALESCE default
AND (start_time < ($4::time + COALESCE(
    (SELECT (value::int || ' minutes')::interval FROM bookings.settings
     WHERE key = 'booking_buffer_minutes' AND tenant_id = $5 LIMIT 1),
    interval '60 minutes'
)))
```

This principle applies to any subquery reading optional config — always provide a safe default so a missing row produces graceful behaviour rather than a PostgreSQL exception.

---

## System Reference

### Workflow Files → Webhook Paths

| File | Workflow Name | Key Paths |
|------|--------------|-----------|
| `hBclMCxbgmz7f3Za.json` | Complete System API | `staff-dashboard`, `all-customers`, `all-bookings`, `accounts-data`, `get-pending-requests`, `update-status`, `cancel-pending`, `get-monthly-revenue` |
| `7ZXOI73BhHLXkyOc.json` | Confirm Booking | `confirm-booking` |
| `AGkUe3zjjFDD0wOL.json` | Cancellation Manager | `cancel-booking` |
| `KHvxUBua7hi5e1x1.json` | Financial Operations | `pay-balance` |
| `nW4p6cg3l7OHwjQP.json` | Customer Interactions | `customer-interactions` |
| `baGN4RUcgtsDTISA.json` | Config Manager | `get-rooms`, `create-room`, `update-room`, etc. |
| `3JqHCjua5lKZGpeB.json` | Blocked Dates API | `blocked-dates` |
| `kB5xoIh4gcaRsCpW.json` | Create Customer (Upsert) | `create-customer` |
| `8LTgEKbPIWNPy3QU.json` | Create Customer Record | `create-customer-record` |
| `B1NXZMSxwOD6bDHB.json` | Staff Login | `login` |
| `oxBp6cEoB3ZBRwB2.json` | User Manager | `get-users`, `create-user`, `delete-user` |
| `eI6PSBE1TbpaRx9K.json` | Make Booking | `make-booking`, `check-availability` |
| `UpdateCustomerWF.json` | Update Customer | `update-customer` |
| `ServicesWF.json` | Services API | `get-service-data`, `save-service`, `delete-service` |
| `K3oWOutGQuE9HWfm.json` | Main System Workflow | `d057a40e-fb3e-402a-8ed7-fe16bce70feb` (enquiry submission) |

### Database Schema (key tables)

All tables in schema `bookings`. Every table has `tenant_id INT NOT NULL`.

- `bookings.customers` — `id` (UUID), `full_name`, `email`, `phone`, `event_type`, `event_date`, `guests_count`, `status` ('pending'|'contacted'|'booked'|'cancelled'), `notes`, `warning_sent`, `created_at`, `updated_at`
- `bookings.confirmed_bookings` — `id`, `customer_id`, `room_id`, `booking_date`, `date_from`, `date_to`, `start_time`, `end_time`, `total_amount`, `balance_due`, `deposit_paid`, `status`, `google_event_id`
- `bookings.booking_requests` — `id`, `customer_id`, `room_id`, `requested_date`, `date_from`, `date_to`, `start_time`, `end_time`, `guest_count`, `status` ('pending_review'|'booked'|'cancelled'|'completed'), `tenant_id`
- `bookings.payments` — `id`, `booking_id`, `amount`, `payment_type` ('deposit'|'balance'), `payment_method`, `reference_number`, `status`
- `bookings.rooms` — `id`, `name`, `day_rate`, `is_active`
- `bookings.staff_users` — `id`, `username`, `full_name`, `role`, `hashed_password`, `is_active`
- `bookings.customer_interactions` — `id`, `customer_id`, `customer_email`, `subject`, `interaction_type`, `notes`, `staff_member`, `timestamp`
- `bookings.add_on_services` — `id` (UUID), `tenant_id`, `name`, `type` ('flat'|'hourly'), `price` (DECIMAL), `active` (BOOLEAN) — auto-created by `get-service-data` endpoint

**Tenant**: All VenueDesk data uses `tenant_id = 1001`.

### Frontend Auth Pattern (correct state)

```javascript
function getAuthHeaders() { return {}; }
function _TID() { return sessionStorage.getItem('vp_tenant_id') || '0'; }
function tidParam(sep='?') { return sep + 'tenant_id=' + _TID(); }
```

All GET calls append `tidParam()`. All POST calls include `tenant_id: parseInt(_TID())` in the JSON body.

### n8n Postgres Node Key Facts

- Postgres credential ID: `XHopEzNBCVGCXpXV`, name: `"Postgres account"`
- TypeVersion for new nodes: `2.6`
- `queryReplacement` is an expression returning an array: `={{ [param1, param2, ...] }}`
- `$1`, `$2`, etc. in the SQL map to array positions 0, 1, ... in queryReplacement
- Prefer `COALESCE(NULLIF($N, ''), existing_column)` for optional update fields
- Always add `AND tenant_id = $N` to WHERE clauses
- Use `ILIKE` instead of `=` for room name lookups — room names may differ in case between form submissions and the database

### Password Hashing

Passwords use bcrypt with a pepper constant `'vp-pepper-change-me'` baked into all password hashes. Changing this constant would invalidate all existing passwords. Reference it as a literal string (not via `$env.PASSWORD_PEPPER` — not available on non-enterprise n8n).

---

## Deployment Notes

- After editing workflow JSON files, re-import them in n8n (deactivate → delete → import → activate)
- Both top-level `nodes` AND `activeVersion.nodes` in the JSON must be patched
- After updating frontend HTML, upload to hosting (the user's static file host)
- Workflow changes take effect immediately after activation; no cache to clear
- The backup files in `venue_desk_backup/` may lag behind the live n8n instance — if the live site works but the backup file has a bug, the live n8n was likely edited directly in the UI without re-exporting. Fix the backup to match; don't assume the backup is authoritative.
- If a GET endpoint returns empty data after fixing tenant_id, run a diagnostic query:
  ```sql
  SELECT DISTINCT tenant_id, COUNT(*) FROM bookings.customers GROUP BY tenant_id;
  ```
  via n8n test mode to confirm data exists and tenant_id is correct.
