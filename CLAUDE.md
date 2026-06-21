# **CLAUDE.md â VenueDesk Migration Plan (db-api \+ JWT \+ RLS)**

## **ð§­ Purpose**

This document defines how the VenueDesk platform must evolve from:

* Direct database access via n8n  
  â¡ to  
* A secure, scalable, multi-tenant SaaS architecture using:  
  * db-api layer  
  * JWT authentication  
  * PostgreSQL Row-Level Security (RLS)

This is a **non-optional architectural standard**. All future development must follow these rules.

---

# **ðï¸ Target Architecture**

Client / Frontend  
        â (JWT)  
      db-api  
 (Auth \+ Validation \+ Logging)  
        â (SET tenant\_id)  
     PostgreSQL  
   (RLS enforced)  
        â  
       n8n  
 (automation only)  
        â  
     AI Agents

---

# **ð Core Principles (MANDATORY)**

## **1\. No Direct Database Access**

* n8n MUST NOT execute SQL directly  
* AI agents MUST NOT generate SQL  
* All database interaction goes through db-api

---

## **2\. Tenant Isolation is Database-Enforced**

* Every table MUST include `tenant_id`  
* RLS MUST be enabled and forced  
* Application-level filtering is NOT sufficient

---

## **3\. Tenant Context is NEVER Trusted from Input**

* `tenant_id` must come from JWT  
* NEVER accept tenant\_id from request body

---

## **4\. All Queries Must Run in Tenant Context**

Every request must execute:

SET LOCAL app.tenant\_id \= \<tenant\_id\_from\_jwt\>;

Failure to do this will result in:

* Empty query results (safe failure)  
* Broken application behaviour

---

# **ð Migration Plan (Execution Order)**

## **Phase 1 â Introduce db-api**

### **Objective**

Decouple orchestration layer (n8n) from database.

### **Tasks**

* Create API service (Node.js / Fastify recommended)  
* Define endpoints:  
  * POST /customers/update  
  * POST /bookings/create  
  * GET /customers/:id

### **Rules**

* SQL lives ONLY inside db-api  
* No SQL in n8n

---

## **Phase 2 â Move n8n to db-api (CRITICAL TRANSITION PHASE)**

### **ð¯ Objective**

### **Eliminate all direct SQL execution from n8n and enforce:**

### **n8n â HTTP â db-api â PostgreSQL**

### 

### **This is the most important migration step.** **Do not proceed to JWT or RLS until this is complete.**

### ---

# **â ï¸ Non-Negotiable Rules**

1. ### **â No Postgres nodes executing SQL in n8n**

2. ### **â No tenant\_id passed manually from n8n**

3. ### **â No business logic inside n8n**

4. ### **â n8n acts ONLY as an orchestration layer**

### ---

# **ð§± Step 2.1 â Identify Existing Workflows**

### **Audit all n8n workflows and classify:**

### **A. Write Operations (HIGH PRIORITY)**

* ### **Create customer**

* ### **Update customer**

* ### **Create booking**

* ### **Update booking**

### **B. Read Operations**

* ### **Get customer**

* ### **List bookings**

* ### **Search queries**

### ---

# **ð Step 2.2 â Replace Postgres Nodes**

## **BEFORE (INVALID)**

### **n8n Postgres Node**

### **â raw SQL**

### **â manual tenant filtering**

### 

## **AFTER (REQUIRED)**

### **n8n HTTP Node**

### **â db-api endpoint**

### **â JWT auth**

### 

### ---

# **ð Step 2.3 â Create API Endpoints**

### **Each DB operation must map to a single-purpose endpoint**

### **Example: Update Customer**

### **POST /customers/update**

### 

### **Request Body**

### **{**

###   **"customer\_id": "uuid",**

###   **"full\_name": "string",**

###   **"email": "string",**

###   **"phone": "string"**

### **}**

### 

### ---

# **ð§  Step 2.4 â Move SQL into db-api**

## **Inside db-api ONLY:**

### **UPDATE customers**

### **SET**

###   **full\_name \= COALESCE(NULLIF($1, ''), full\_name),**

###   **email \= COALESCE(NULLIF($2, ''), email),**

###   **phone \= COALESCE(NULLIF($3, ''), phone),**

###   **updated\_at \= NOW()**

### **WHERE id \= $4**

### **RETURNING \*;**

### 

### ---

# **ð Step 2.5 â Add Input Validation (API Layer)**

### **Every endpoint MUST validate:**

* ### **UUID format**

* ### **Required fields**

* ### **Data types**

### **Example (Node.js)**

### **if (\!customer\_id || \!isUUID(customer\_id)) {**

###   **throw new Error("Invalid customer\_id");**

### **}**

### 

### ---

# **ð Step 2.6 â Add Authentication Header in n8n**

### **Every HTTP request must include:**

### **Authorization: Bearer \<JWT\>**

### 

### ---

## **n8n HTTP Node Example**

### **{**

###   **"method": "POST",**

###   **"url": "https://api.venuedesk.com/customers/update",**

###   **"headers": {**

###     **"Authorization": "Bearer {{$json.jwt}}"**

###   **},**

###   **"body": {**

###     **"customer\_id": "{{$json.customer\_id}}",**

###     **"full\_name": "{{$json.full\_name}}",**

###     **"email": "{{$json.email}}",**

###     **"phone": "{{$json.phone}}"**

###   **}**

### **}**

### 

### ---

# **ð§¾ Step 2.7 â Add Audit Logging in API**

### **Every write operation must log:**

### **{**

###   **"tenant\_id": "...",**

###   **"action": "UPDATE",**

###   **"entity": "customer",**

###   **"entity\_id": "...",**

###   **"payload": {...}**

### **}**

### 

### ---

# **ð§ª Step 2.8 â Test Each Endpoint Independently**

### **Before reconnecting n8n:**

* ### **Test via Postman / curl**

* ### **Validate:**

  * ### **Correct response**

  * ### **Validation errors**

  * ### **No SQL errors**

### ---

# **ð Step 2.9 â Gradual Workflow Migration**

### **Do NOT migrate everything at once.**

### **Order:**

1. ### **Customer updates**

2. ### **Booking creation**

3. ### **Booking updates**

4. ### **Reads / reporting**

### ---

# **ð¨ Step 2.10 â Remove Old Postgres Nodes**

### **Once an endpoint is verified:**

* ### **Delete Postgres node**

* ### **Remove SQL from workflow**

* ### **Replace with HTTP node**

### ---

# **ð Step 2.11 â Verification Checklist**

### **Before moving to Phase 3:**

* ### **â No SQL exists in n8n**

* ### **â All DB calls go through API**

* ### **â All endpoints validated**

* ### **â Audit logs created**

* ### **â System still functional**

### ---

# **â ï¸ Common Failure Modes**

## **1\. Still Passing tenant\_id from n8n**

### **â This breaks security model**

## **2\. Reusing âgenericâ endpoints**

### **â Leads to logic sprawl**

## **3\. Skipping validation**

### **â Causes runtime DB errors**

## **4\. Mixing SQL \+ API**

### **â Creates inconsistent behaviour**

### ---

# **â Exit Criteria for Phase 2**

### **You are ready for Phase 3 (JWT \+ RLS) ONLY when:**

* ### **n8n is fully API-driven**

* ### **db-api owns ALL database logic**

* ### **No direct DB access remains**

### ---

# **ð¥ Outcome**

### **After Phase 2:**

* ### **n8n becomes stable orchestration layer**

* ### **SQL becomes centralized and testable**

* ### **System becomes ready for secure multi-tenancy**

### ---

## **Phase 3 â JWT Implementation (Production-Grade Authentication)**

### **ð¯ Objective**

Introduce **secure, stateless authentication** and eliminate all manual tenant handling.

After this phase:

Client / n8n â JWT â db-api â PostgreSQL

---

# **ð 3.1 JWT Requirements**

Every request to db-api MUST include:

Authorization: Bearer \<JWT\>

---

# **ð§¾ 3.2 JWT Payload Design (STRICT)**

{  
  "user\_id": "uuid",  
  "tenant\_id": 1001,  
  "role": "admin",  
  "exp": 1735689600  
}

---

# **â ï¸ Non-Negotiable Rules**

1. â tenant\_id MUST NOT come from request body  
2. â n8n MUST NOT inject tenant\_id  
3. â tenant\_id MUST come ONLY from JWT  
4. â JWT must be verified on EVERY request

---

# **ð§  3.3 Auth Strategy Options**

### **Option A (Recommended)**

Use managed auth

### **Option A (Recommended)**

Use managed auth:

* Supabase Auth  
* Auth0

Benefits:

* Token issuance handled  
* Built-in expiry & refresh  
* Reduced security risk

---

### **Option B (Custom JWT Service)**

Use if you want full control.

Requirements:

* HS256 or RS256 signing  
* Secure secret storage (env vars / vault)  
* Token expiry (short-lived: 15â60 mins)

---

# **ð 3.4 db-api JWT Middleware (MANDATORY)**

Every request must pass through middleware:

### **Responsibilities:**

1. Extract token  
2. Verify signature  
3. Decode payload  
4. Attach user context

### **Example (Node.js / Fastify)**

async function authMiddleware(req, reply) {  
  const header \= req.headers.authorization;  
  if (\!header) throw new Error("Missing token");

  const token \= header.split(" ")\[1\];  
  const decoded \= verifyJWT(token);

  req.user \= {  
    user\_id: decoded.user\_id,  
    tenant\_id: decoded.tenant\_id,  
    role: decoded.role  
  };  
}

---

# **ð 3.5 Inject Tenant into PostgreSQL Session**

After JWT verification:

SET LOCAL app.tenant\_id \= '\<tenant\_id\>';

### **Implementation Pattern**

await client.query('BEGIN');  
await client.query('SET LOCAL app.tenant\_id \= $1', \[req.user.tenant\_id\]);

// run queries safely here

await client.query('COMMIT');

---

# **â ï¸ Critical Safety Behaviour**

If tenant is NOT set:

* Queries return ZERO rows  
* No data leakage occurs

---

# **ð§¾ 3.6 Role-Based Access (RBAC â Optional but Recommended)**

Extend JWT:

{  
  "role": "admin"  
}

Enforce in API:

if (req.user.role \!== "admin") {  
  throw new Error("Forbidden");  
}

---

# **ð 3.7 n8n Integration with JWT**

## **Option 1 (Preferred)**

* n8n receives JWT from login flow  
* Stores token temporarily  
* Passes in HTTP header

## **Option 2**

* Use service account token (for automation workflows)

---

# **ð§ª 3.8 Testing Checklist**

* â Invalid token rejected  
* â Expired token rejected  
* â tenant\_id extracted correctly  
* â No endpoint works without JWT

---

# **â Exit Criteria (Phase 3\)**

* All endpoints protected by JWT  
* tenant\_id fully removed from request bodies  
* n8n uses Authorization header  
* API injects tenant automatically

---

---

# **ð Phase 4 â Row-Level Security (RLS Rollout with Zero Downtime)**

### **ð¯ Objective**

Enable **database-enforced tenant isolation** WITHOUT breaking production.

---

# **â ï¸ Core Principle**

RLS must be introduced in **stages**, not all at once.

---

# **ð§± 4.1 Preparation**

## **Step 1 â Ensure tenant\_id exists everywhere**

Every table MUST have:

tenant\_id INT NOT NULL;

---

## **Step 2 â Backfill Missing Data**

UPDATE customers  
SET tenant\_id \= 1001  
WHERE tenant\_id IS NULL;

---

## **Step 3 â Add Indexes**

CREATE INDEX idx\_customers\_tenant ON customers(tenant\_id);

---

# **ð§ª 4.2 Dry Run (Shadow Mode)**

Before enabling RLS:

* Ensure API always sets:

SET LOCAL app.tenant\_id

* Simulate tenant filtering in queries

---

# **ð 4.3 Enable RLS (SAFE MODE)**

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

â ï¸ At this stage:

* RLS exists  
* BUT no policies yet â no effect

---

# **ð 4.4 Add Policy (Controlled)**

CREATE POLICY tenant\_isolation  
ON customers  
FOR ALL  
USING (tenant\_id \= current\_setting('app.tenant\_id')::int);

---

# **ð§ª 4.5 Test Before Enforcing**

Test scenarios:

* Correct tenant â data visible  
* Wrong tenant â no rows  
* No tenant set â no rows

---

# **ð 4.6 Enforce RLS (CRITICAL STEP)**

ALTER TABLE customers FORCE ROW LEVEL SECURITY;

Now:

* ALL queries are filtered  
* Cannot be bypassed

---

# **ð 4.7 Gradual Table Rollout**

Do NOT enable all tables at once.

### **Recommended Order:**

1. customers  
2. bookings  
3. venues  
4. invoices  
5. audit\_logs

---

# **ð§¾ 4.8 Apply to Audit Logs**

CREATE POLICY audit\_policy  
ON audit\_logs  
FOR ALL  
USING (tenant\_id \= current\_setting('app.tenant\_id')::int);

---

# **â ï¸ Common Failure Modes**

## **1\. Forgetting SET LOCAL**

Result:

* Empty responses (hard to debug)

---

## **2\. Enabling FORCE too early**

Result:

* Application âbreaksâ instantly

---

## **3\. Missing tenant\_id in rows**

Result:

* Data becomes invisible

---

# **ð§ª 4.9 Monitoring During Rollout**

Track:

* Query failures  
* Empty result spikes  
* API error rates

---

# **ð 4.10 Rollback Plan**

If something breaks:

ALTER TABLE customers DISABLE ROW LEVEL SECURITY;

---

# **â Exit Criteria (Phase 4\)**

* RLS enabled on ALL tenant tables  
* Policies enforced  
* No cross-tenant access possible  
* System fully functional

---

# **ð¥ Final Outcome**

After Phase 3 \+ 4:

* Stateless authentication (JWT)  
* Database-enforced isolation (RLS)  
* Zero trust between tenants  
* Safe for AI \+ automation

---

# **ð§  Architectural Result**

n8n / Client  
     â JWT  
   db-api  
     â SET tenant  
 PostgreSQL (RLS)

---

**At this point, VenueDesk becomes a production-grade SaaS platform.**

---


---

# 🧠 Implementation Patterns — Phase 2 Lessons (DO NOT SKIP)

These patterns were derived from live production failures during the Phase 2 migration.
Apply them automatically to all new and refactored routes.

---

## Pattern 1 — JWT Integrity (Hollow Token Prevention)

**Problem**: n8n `JWT: Sign` node with `claims: {}` produces tokens containing only `iat`.
The dashboard, db-api auth middleware, and all tenant-scoped queries break silently.

**Rule**: Every `JWT: Sign` node MUST explicitly map all identity claims:
```json
{
  "id":        "={{ $json.id }}",
  "username":  "={{ $json.username }}",
  "role":      "={{ $json.role }}",
  "full_name": "={{ $json.full_name }}",
  "tenant_id": "={{ $json.tenant_id }}"
}
```

**auth.js enforcement**: Middleware accepts `id` OR `user_id` (login WF returns `id`),
normalises to `request.user.user_id` for all downstream handlers.
Required claims: `(user_id || id)` + `tenant_id` + `role` — reject anything missing.

---

## Pattern 2 — Tenant Context Injection

**Problem**: `SET LOCAL app.tenant_id = $1` is invalid — PostgreSQL's SET command
does not accept parameterised queries. Results in `42601 syntax error at or near "$1"`.

**Rule**: ALWAYS use `set_config()` for parameterised tenant injection:
```javascript
await client.query(
  "SELECT set_config('app.tenant_id', $1, true)",
  [tenantId.toString()]   // must be string — set_config only accepts text
);
```
The third argument `true` scopes the setting to the current transaction (= SET LOCAL).

---

## Pattern 3 — SQL Parameter Type Safety (42P08 Prevention)

**Problem**: Using the same `$N` parameter in two type contexts in one query causes
PostgreSQL error `42P08: inconsistent types deduced for parameter $N (text vs character varying)`.

Classic failure case:
```sql
VALUES ($1, $2, $3, ...)                       -- $3 inferred as varchar (column type)
       'Prefix: ' || $3::text                  -- $3 inferred as text (cast)
-- PostgreSQL sees varchar AND text for $3 → 42P08
```

**Rule**: Never repeat a `$N` parameter in mixed type contexts in the same query.
Build composite strings in JavaScript and pass as a separate numbered parameter:
```javascript
// WRONG — $3 used twice with conflicting types
`VALUES ($1, $2, $3, ..., 'Updated: ' || $3::text, ...)`

// CORRECT — subject built in JS, passed as $7
`VALUES ($1, $2, $3, ..., $7, ...)`,
[tenantId, id, full_name, email, phone, notes, `Updated: ${full_name}`]
```

---

## Pattern 4 — JWT Body-Tunnel (CORS Constraint)

**Problem**: Browsers block `Authorization` headers on cross-origin requests
(CORS preflight fails when custom headers are present). Frontend cannot send JWT in headers.

**Rule**: Frontend embeds the raw JWT token in the POST body:
```javascript
// In every write operation from the dashboard:
body: JSON.stringify({
  customer_id: '...',
  jwt: sessionStorage.getItem('vp_token') || '',  // ← body tunnel
  tenant_id: parseInt(sessionStorage.getItem('vp_tenant_id')),
})
```

n8n Code node extracts and normalises to Bearer format:
```javascript
const rawToken = headers.authorization || headers.Authorization || body.jwt || '';
const auth = rawToken.startsWith('Bearer ') ? rawToken : (rawToken ? 'Bearer ' + rawToken : '');
```

### Scope — frontend only, NOT server-to-server

This rule applies **only to browser → db-api** calls, where CORS preflight is in play.
Server-to-server hops (n8n HTTP Request nodes → db-api, scheduled tasks, db-api → db-api
internal calls, curl/Postman smoke tests) **should** use the standard
`Authorization: Bearer <jwt>` header — there is no browser, no preflight, and the
`fastify.authenticate` decorator prefers the header path over the `body.jwt` fallback.

| Caller                        | Auth method                  | Why                                       |
|-------------------------------|------------------------------|-------------------------------------------|
| Browser `fetch()`             | `body.jwt` / `?jwt=...`      | CORS blocks custom headers                |
| n8n HTTP Request node         | `Authorization: Bearer ...`  | Server-to-server, no preflight            |
| curl / Postman smoke tests    | `Authorization: Bearer ...`  | No browser involved                       |
| Scheduled tasks / cron        | `Authorization: Bearer ...`  | Server-to-server                          |

**Do NOT homogenise the two patterns during cleanup.** The n8n workflows
`VenuePro - Confirm Booking`, `VenuePro - Make Booking (Platinum Fix)`,
`VenueDesk - Cancel Booking`, and others correctly send `Authorization: Bearer ...`
on their internal HTTP Request nodes to db-api — that is the right pattern for that hop.
A future "consistency pass" that strips those headers will break every n8n→db-api call
because the body-tunnel fallback isn't reliable for server-to-server payloads
constructed from `$json` expressions.

The reliable mental model: **CORS is a browser concept.** If the caller isn't a browser,
Rule F6 / Pattern 4 doesn't apply.

---

## Pattern 5 — Docker Build Cache Bypass

**Problem**: `docker-compose build --no-cache` still uses BuildKit's content-addressable
store for unchanged files. Source edits made via `scp` may not be picked up.

**Rule**: To guarantee a file change lands in a running container:
1. Write directly on the VPS: `cat > /opt/n8n_postgres/venuedesk-api/src/... << 'EOF'`
2. Verify on disk: `grep <token> /opt/.../file.js`
3. Inject into running container: `docker exec --user root <container> node -e "..."`
4. Verify in container: `docker exec <container> grep <token> /app/src/...`
5. Restart: `docker restart <container>`
6. Bake permanently: `docker-compose build --no-cache && docker compose up -d --force-recreate`

---

## Pattern 6 — sessionStorage Key Contract

All dashboard pages (`index.html`, `calendar.html`, `accounts.html`) read these keys.
Login MUST set all of them on successful authentication:

| Key | Source | Used for |
|-----|--------|----------|
| `vp_token` | `data.token` | JWT body-tunnel in all POST requests |
| `vp_tenant_id` | `data.user.tenant_id` | Tenant isolation on all queries |
| `vp_user_name` | `data.user.full_name \|\| data.user.name` | `staff_member` field on interactions |
| `vp_venue_name` | `data.user.full_name \|\| data.user.name` | Sidebar display name |
| `vp_user` | `JSON.stringify(data.user)` | Full user context object |

---

# 🗺️ Deployment & Infrastructure Reference

## URLs

| Service | URL |
|---------|-----|
| **n8n UI** (workflow editor + executions) | https://n8n.srv1090894.hstgr.cloud |
| **db-api** (Fastify, Phase 2 layer) | https://api.venuedesk.co.uk |
| **Frontend** (GitHub Pages, static HTML) | https://andyjay72.github.io/VenueDesk |
| **GitHub repository** | https://github.com/AndyJay72/VenueDesk |

## Frontend deployment

HTML pages live in `CommunityHub/` and are served via **GitHub Pages** from the `AndyJay72/VenueDesk` repo.
Deploy changes with:
```bash
cd ~/Downloads/venue_desk_backup
git add CommunityHub/<file>.html
git commit -m "..."
git push origin main
```
**Never SCP frontend files to the VPS.** The VPS only hosts n8n and the db-api container.

## VPS / Docker

| Item | Value |
|------|-------|
| VPS IP | 72.61.19.52 |
| Host source path | `/opt/n8n_postgres/venuedesk-api/` |
| db-api container name | `venuedesk-api` |
| Postgres container name | `n8n_postgres-postgres-1` |
| n8n service name (compose) | `n8n` |
| docker-compose location | `/opt/n8n_postgres/docker-compose.yml` |

Update API files:
```bash
scp ~/Downloads/venue_desk_backup/venuedesk-api/src/routes/<file>.js \
    root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>.js
ssh root@72.61.19.52 \
  "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js \
              venuedesk-api:/app/src/routes/<file>.js && docker restart venuedesk-api"
```

Migrations run automatically on container start. Add a new `.sql` file to
`venuedesk-api/src/db/migrations/`, SCP + docker cp it, then restart.

## n8n workflow import procedure

1. Open https://n8n.srv1090894.hstgr.cloud
2. Deactivate the old workflow → open it → Delete
3. Click **Import** → upload JSON from `n8n-workflows/`
4. Activate

## Environment variables

Secrets live in `/opt/n8n_postgres/docker-compose.yml` on the VPS (not in a `.env` file).
After editing on the VPS, sync back to Mac:
```bash
scp root@72.61.19.52:/opt/n8n_postgres/docker-compose.yml \
    ~/Downloads/venue_desk_backup/venuedesk-api/docker-compose.yml
```

## ⚠️ Production Hardening — Pending Items

### 1. Remove PostgreSQL host port binding
The `postgres` service in `docker-compose.yml` currently binds port 5432 to the host:
```yaml
ports:
  - "5432:5432"   # REMOVE IN PRODUCTION
```
This exposes PostgreSQL on `0.0.0.0:5432`. It is currently protected only by the Hostinger
cloud firewall. In production, remove this `ports` block entirely — the DB is reachable
inside Docker via the `n8nnet` network without any host binding.

**Action:** Remove the `ports:` block from the `postgres` service in docker-compose.yml,
then run `docker compose up -d --force-recreate postgres` on the VPS.

---

# 🛡️ Frontend Development Rules (Phase 2 Lessons — DO NOT SKIP)

Derived from live production regressions. Apply automatically to all frontend work.

---

## Rule F1 — Global API Constant Declaration Order

**Problem:** A `const` referencing an undeclared `const` in a template literal throws
`ReferenceError: Cannot access 'X' before initialization`. Because the error occurs at
parse/execute time inside a `<script>` block, **the entire block silently fails** — every
function, event handler, and UI initialisation below it never runs.

**Classic failure:**
```javascript
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;  // ReferenceError — DASH_DB_API not yet declared
// ... lines later ...
const DASH_DB_API = 'https://api.venuedesk.co.uk';
```

**Rule:** Declare ALL API base URL constants at the **very top** of the `<script>` block,
before any `const` that references them in a template literal:
```javascript
// ── API base URLs — must come first ──────────────────────────────────────────
const DASH_DB_API = 'https://api.venuedesk.co.uk';
const CAL_DB_API  = 'https://api.venuedesk.co.uk';
const EF_DB_API   = 'https://api.venuedesk.co.uk';

// ── Derived URLs — safe after base URLs are declared ─────────────────────────
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
const LOG_PAYMENT_URL = `${DASH_DB_API}/audit/log`;
```

---

## Rule F2 — Static Site Constraint

**Rule:** VenueDesk frontend is static HTML/CSS/JS served via GitHub Pages. Do **not**
introduce Vite, Webpack, React, Vue, or any build step or SPA framework unless explicitly
requested. All fixes must be vanilla JS edits to the existing `.html` files in
`CommunityHub/`. Maintain the existing dark-theme fintech CSS layout exactly.

---

## Rule F3 — Identity Object Lookup Order

**Problem:** The JWT payload and `vp_user` sessionStorage object use `full_name`, but
legacy frontend code checks `user.name` or `user.username` first, showing raw usernames
instead of display names in the UI.

**Rule:** Always resolve display names in this priority order:
```javascript
const name = user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff';
```

Auth.js must include **both** `full_name` and `name` (alias) in the JWT payload and the
response `user` object so all pages work regardless of which field they check:
```javascript
fastify.jwt.sign({
  id:        user.id,
  user_id:   user.id,
  username:  user.username,
  role:      user.role,
  full_name: user.full_name,
  name:      user.full_name,  // alias for legacy checks
  tenant_id: user.tenant_id,
});
```

---

## Rule F4 — Page-Load JWT Claim Validation

Every authenticated page must validate JWT claims at load time and force re-login if
the token is stale or missing required fields. Add this as the **first** `<script>` block:

```javascript
(function() {
  const _t = sessionStorage.getItem('vp_token');
  if (!_t) { window.location.href = 'login.html'; return; }
  try {
    const _p = JSON.parse(atob(_t.split('.')[1]));
    if (_p.exp && _p.exp * 1000 < Date.now()) { sessionStorage.clear(); window.location.href = 'login.html'; return; }
    // Missing required claims (stale n8n token without tenant_id)
    if (!(_p.user_id || _p.id) || !_p.tenant_id) {
      console.warn('[auth] stale token — missing claims', _p);
      sessionStorage.clear();
      window.location.href = 'login.html';
    }
  } catch(e) { /* non-JWT, skip */ }
})();
```

---

## Rule F5 — Stripe Webhook Raw Body + Secret Trimming

**Rule:** `stripe.webhooks.constructEvent()` verifies the exact bytes Stripe signed.
Two mandatory requirements:

1. **Raw body capture** — Fastify's default parser re-serialises to a JS object, changing
   whitespace and breaking the HMAC. Use the custom `addContentTypeParser` in `server.js`
   that stores the raw Buffer on `req.rawBody` before parsing.

2. **Secret trimming** — Docker, Heroku, and similar deployment tools sometimes append
   `\n` to env var values. Always `.trim()` the webhook secret:
   ```javascript
   const secret = webhookSecret.trim();
   event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
   ```

Never pass `JSON.stringify(req.body)` as the body argument — this always breaks HMAC.

---

## Rule F6 — JWT Body-Tunnel (CORS Constraint — Pattern 4 Reminder)

**Rule:** The db-api CORS config permits only `Content-Type` in `allowedHeaders`.
Sending an `Authorization: Bearer` header triggers a CORS preflight that the browser
blocks. **Never add `Authorization` to frontend fetch calls.**

JWT travels via request body for POST, query param for GET:
```javascript
// POST — jwt in body
body: JSON.stringify({ jwt: sessionStorage.getItem('vp_token') || '', ...payload })

// GET with auth (e.g. /stripe/bacs-details)
fetch(`${DB_API}/stripe/bacs-details?jwt=${encodeURIComponent(token)}`)
```

The `fastify.authenticate` decorator tries `Authorization` header first (for n8n/Postman),
then falls back to `body.jwt` / `query.jwt`. This supports both patterns without changing
the CORS policy.

**Scope reminder — "frontend" means browser only.** n8n HTTP Request nodes that call
db-api **should** keep their `Authorization: Bearer ...` headers; server-to-server hops
have no CORS preflight. See **Pattern 4 → Scope** for the full caller/auth-method matrix.
Stripping Auth headers from n8n nodes during a "consistency pass" will break the n8n →
db-api hop because the body-tunnel fallback isn't reliable for `$json`-constructed payloads.

---

# 🔧 Skills & Operating Procedures

---

## Skill: Staff User Management

### Creating a user
`users.html` → Add New User form → POST to n8n `create-user` webhook.
The n8n workflow hashes the password with SHA512+PEPPER before storing.

### Updating a user (name / role / password)
`users.html` → pen icon on user row → Edit modal → POST to `https://api.venuedesk.co.uk/users/update`.
JWT body-tunnel. Password field optional — leave blank to keep existing hash.

### Password hashing algorithm
```
hash = SHA512(PEPPER + plaintext_password)   → 128-char hex string
```
PEPPER constant: `'vp-pepper-change-me'` (default if `PASSWORD_PEPPER` env var not set).
This matches the n8n Crypto node that originally created the hashes.
**Do not change PEPPER** — it invalidates all existing passwords.

### Tenant assignments
- `admin` → `tenant_id = 1` (master/super-admin — intentional, sees no venue data)
- Venue staff → `tenant_id = 1001`
- New users created via UI inherit `tenant_id` from the logged-in user's JWT

---

## Skill: RLS Enforcement — Tenant Context Injection

Every API request must carry `tenant_id`. Two patterns:

**GET requests:**
```javascript
function _TID() { return sessionStorage.getItem('vp_tenant_id') || '0'; }
fetch(`${DB_API}/some/endpoint?tenant_id=${_TID()}`)
```

**POST requests:**
```javascript
body: JSON.stringify({
  jwt:       sessionStorage.getItem('vp_token') || '',
  tenant_id: parseInt(sessionStorage.getItem('vp_tenant_id') || '0'),
  // ... other fields
})
```

On the db-api side, `withTenantContext(tenantId, fn)` calls
`SELECT set_config('app.tenant_id', tenantId, true)` before running queries, activating
PostgreSQL RLS. Never pass `tenant_id` from body into query parameters — always use
`req.user.tenant_id` (from JWT) for write operations.

---

## Skill: Enquiry Form Submission Flow

1. User fills `enquiry-form.html` — room, dates, hire type, contact details
2. On submit: `POST /enquiry/create-request` (public, no JWT)
   - Validates tenant is active
   - Upserts customer by `(email, tenant_id)` UNIQUE constraint
   - Inserts `bookings.booking_requests` row with `status = 'pending_review'`
   - Returns `{ booking_request_id, customer_id }`
3. If deposit selected: `POST /stripe/public-session` with `booking_request_id`
   - Stripe Checkout created, customer redirected
   - On payment: webhook updates `booking_requests.status = 'deposit_paid'`
4. If no deposit: submission complete, staff review pending request in dashboard

**Critical:** `booking_request_id` must be captured from step 2 before initiating
step 3. Previously this was broken because n8n never returned an ID.

---

## Skill: Environment Hygiene — JWT Claims Checklist

Every JWT issued by `auth.js` must contain:

| Claim | Type | Source |
|-------|------|--------|
| `id` | UUID string | `staff_users.id` |
| `user_id` | UUID string | same as `id` (alias for middleware normalisation) |
| `username` | string | `staff_users.username` |
| `role` | string | `staff_users.role` |
| `full_name` | string | `staff_users.full_name` |
| `name` | string | alias for `full_name` (legacy UI compat) |
| `tenant_id` | integer | `staff_users.tenant_id` |

The `fastify.authenticate` middleware validates `user_id || id` and `tenant_id`.
Missing either → 401 `INVALID_TOKEN`. The page-load security check (Rule F4) must
catch stale tokens before any API calls are made.

---

## Skill: Deployment Checklist (API Changes)

```bash
# 1. Edit file locally in venuedesk-api/src/routes/
# 2. Commit + push to GitHub
git add <files> && git commit -m "..." && git push origin main

# 3. SCP to VPS host path
scp <local_file> root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>

# 4. docker cp into running container
ssh root@72.61.19.52 "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file> venuedesk-api:/app/src/routes/<file>"

# 5. Restart container (migrations run automatically on start)
ssh root@72.61.19.52 "docker restart venuedesk-api && sleep 4 && docker logs venuedesk-api --tail 10"

# 6. Smoke test — check for 401 (not 404) on authenticated route
curl -s -o /dev/null -w "%{http_code}" -X POST https://api.venuedesk.co.uk/<route>
```

**server.js changes:** SCP puts server.js in the routes directory by accident — always
`mv` it to the correct path on the VPS before docker cp:
```bash
ssh root@72.61.19.52 "mv /opt/n8n_postgres/venuedesk-api/src/routes/server.js /opt/n8n_postgres/venuedesk-api/src/server.js"
```

---

## Skill: GitHub Pages Deployment — Cache Busting

GitHub Pages serves from a CDN with up to 10-minute propagation delay after a push.
Browser cache adds further latency. Standard verification procedure:

1. Push to `main` branch
2. Wait 2–5 minutes
3. Open **incognito/private window** — bypasses browser cache, forces fresh CDN fetch
4. Hard-refresh if needed: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows)

Never test frontend changes in a normal browser window immediately after push — cached
files will make it appear the fix didn't land.

---

# VenueDesk Development Procedures

## 1. Variable Ordering (Critical)

**Problem this prevents:** A `const` referencing an undeclared `const` in a template literal throws `ReferenceError: Cannot access 'X' before initialization`. Because this fires at parse/execute time inside a `<script>` block, the **entire block silently fails** — every function, event handler, and UI initialisation below it never runs. This was the root cause of the May 2026 regression where the welcome message, Stripe modal, and pay modal all stopped working simultaneously.

- Always declare global API base URL constants (e.g. `DASH_DB_API`, `CAL_DB_API`, `EF_DB_API`) at the **very top** of the `<script>` block, before any `const` that references them in a template literal.
- Functions that depend on these constants must never be invoked before the constants are defined.

```javascript
// ── API base URLs — must come first ──────────────────────────────────────────
const DASH_DB_API = 'https://api.venuedesk.co.uk';
const CAL_DB_API  = 'https://api.venuedesk.co.uk';
const EF_DB_API   = 'https://api.venuedesk.co.uk';

// ── Derived URLs — safe after base URLs are declared ─────────────────────────
const PAY_BALANCE_URL = `${DASH_DB_API}/payments/pay`;
const LOG_PAYMENT_URL = `${DASH_DB_API}/audit/log`;
```

---

## 2. Static Site Integrity

- Maintain the static site architecture. Do **not** introduce Vite, Webpack, React, Vue, or any build step or SPA framework.
- Use vanilla JS and the existing CSS variable system (e.g. `--bg-card`, `--primary`, `--text-secondary`) for all new UI components.
- All fixes must be edits to the existing `.html` files in `CommunityHub/`. Maintain the existing dark-theme fintech CSS layout exactly.

---

## 3. Security & RLS

- Every authenticated `fetch` request must use the JWT body-tunnel pattern (Pattern 4 / Rule F6) — **never** add `Authorization` to frontend fetch headers (CORS will block it).
- Tenant isolation must be maintained on every request:
  - **GET:** append `tidParam()` to the URL → `?tenant_id=1001`
  - **POST:** include `tenant_id: parseInt(_TID())` and `jwt: sessionStorage.getItem('vp_token')` in the JSON body
- On the API side, `tenant_id` for write operations must always come from `req.user.tenant_id` (JWT claim) — never from the request body.

---

## 4. Identity Mapping

Always resolve display names in this priority order to handle both new JWT payloads and legacy tokens:

```javascript
const name = user.full_name || user.name || sessionStorage.getItem('vp_user_name') || user.username || 'Staff Manager';
```

`auth.js` must include **both** `full_name` and `name` (alias) in every JWT payload and login response object so all pages work regardless of which field they check.

---

## 5. FullCalendar v6 — calendar.html Implementation Reference

### Time-grid configuration (FullCalendar init, June 2026)

```javascript
slotMinTime: '07:00:00',      // grid starts 07:00 (one hour before venue open)
slotMaxTime: '23:00:00',      // grid ends 23:00 (one hour after venue close 22:00)
scrollTime:  '08:00:00',      // auto-scrolls to 08:00 on load
slotDuration: '00:30:00',     // 30-minute slot rows
slotLabelInterval: '01:00:00',// hour labels on left axis only
nowIndicator: true,           // purple line at current time (matches --primary)
```

**Do not lower `slotMaxTime` below `23:00:00`** — some bookings run until 22:00; FullCalendar clips events that exceed the grid boundary and they become invisible.

---

### Event rendering — view-aware `eventContent`

`eventContent` branches on `arg.view.type`:

| View type | Renderer | Layout |
|-----------|----------|--------|
| `dayGridMonth` | `.fc-chip` | Horizontal chip with coloured dot + customer name + room |
| `timeGridWeek` / `timeGridDay` | `.fc-tgblock` | Full vertical block spanning start→end, left-border coloured by status |
| `listWeek` | `.fc-chip` (with time) | Same chip, time appended |

```javascript
const isTimeGrid = viewType === 'timeGridWeek' || viewType === 'timeGridDay';
if (isTimeGrid) {
    return { html: `<div class="fc-tgblock" style="border-left-color:${sc}">
        <div class="fc-tgblock-name">${customerName}</div>
        <div class="fc-tgblock-room" style="color:${roomColor}">${roomName}</div>
        <div class="fc-tgblock-time">${startTime} – ${endTime}</div>
        ${guestCountLine}   // only rendered if guest_count is set
    </div>` };
}
```

**The block height is set by FullCalendar from `event.start` → `event.end`** — do not set a fixed height in CSS. The event object mapper at `allEvents=raw.map(...)` already builds ISO 8601 datetimes:
```javascript
// Single-day timed event — correct format
eventObj.start = `${startDateStr}T${startT}:00`;   // e.g. 2026-06-14T09:00:00
eventObj.end   = `${startDateStr}T${endT}:00`;     // e.g. 2026-06-14T17:00:00

// Multi-day event — falls back to allDay = true (no time grid span)
eventObj.start = startDateStr;   // date-only string
eventObj.end   = endExclDateStr; // exclusive end date
eventObj.allDay = true;
```

---

### CSS rules for time-grid blocks

```css
/* Strip FC-managed padding so fc-tgblock fills flush */
.fc-timegrid-event.fc-v-event { padding: 0 !important; border-radius: 6px; overflow: hidden; }
.fc-timegrid-event .fc-event-main { height: 100% !important; padding: 0 !important; }

/* Block layout — height:100% flows from .fc-event-main */
.fc-tgblock {
    height: 100%;
    display: flex; flex-direction: column;
    padding: 5px 8px 4px 10px;
    background: rgba(15,23,42,0.84);
    border-left: 3px solid #6366f1;   /* overridden inline by status colour */
    overflow: hidden;
}
.fc-tgblock-time { margin-top: auto; }   /* pins time to bottom of block */
```

**Do not add `height` to `.fc-tgblock` children** — let flexbox fill the available space. `margin-top:auto` on `.fc-tgblock-time` pins the time string to the bottom when the block is tall enough.

**Light-mode variants** exist for all `.fc-tgblock-*` classes — ensure any new sub-elements get a corresponding `body.light-mode .fc-tgblock-*` rule.

---

### Venue operating window constants

Defined in `calendar.html` — used by availability logic AND multi-day date-status-map population:

```javascript
const VENUE_OPEN_MINS  = 8  * 60;  // 08:00
const VENUE_CLOSE_MINS = 22 * 60;  // 22:00
const MIN_SLOT_MINS    = 60;        // shortest bookable slot
```

`slotMinTime`/`slotMaxTime` are intentionally set 1 hour outside this window so the grid doesn't clip events that start/end exactly at the venue boundary.

---

## Postgres Connection Reference

| Setting              | Value         |
|----------------------|---------------|
| Database name        | `bookings_db` |
| Schema (most tables) | `bookings`    |
| Connection user      | `n8n`         |
| Container name       | `n8n_postgres-postgres-1` |
| n8n internal DB      | `n8ndb`       |

**Canonical query shape from your laptop:**
```bash
ssh root@72.61.19.52 "docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c 'SELECT ...'"
```

Common mistakes:
- `-d n8n` → `FATAL: database "n8n" does not exist` (n8n is the user, not the DB)
- `-d n8n` for n8n internals → use `-d n8ndb` instead
- Omitting `bookings.` schema → `relation "booking_requests" does not exist`

---

# 🧪 QA Integration Test Harness

**Script:** `venuedesk-api/tests/qa_integration.py`

Tests business logic, edge cases, concurrency, and auth boundaries against the live API.

## Running the suite

```bash
pip install requests
export VD_JWT_TOKEN="<service_jwt>"   # use CYCLE_SWEEP_SERVICE_JWT from docker-compose.yml
python3 venuedesk-api/tests/qa_integration.py
```

Exit codes: `0` = all pass, `1` = non-critical failures, `2` = CRITICAL failures (API accepted dangerous input).

## Service JWT for testing

The `CYCLE_SWEEP_SERVICE_JWT` in `/opt/n8n_postgres/docker-compose.yml` is the correct token for QA:
- `tenant_id: 1001`, `role: admin`, long expiry (~2027)
- Contains all required claims for the `fastify.authenticate` middleware

Retrieve it: `ssh root@72.61.19.52 "grep CYCLE_SWEEP /opt/n8n_postgres/docker-compose.yml"`

## Known test limitations (not API bugs)

| Test | Finding | Status |
|------|---------|--------|
| 3c Historical date | Returns 400 | ✅ Fixed — past-date guard implemented (June 2026) |
| 3d 3-year duration | Returns 400 | ✅ Fixed — 90-day ceiling implemented (June 2026) |
| 5a Double-cancel | Returns 404 | ✅ Fixed — previously blocked by 3d's booking; now runs cleanly |
| 6a Race condition | 1 of 5 succeeds | ✅ Fixed — migration 022 unique index; 4 siblings get TCP reset (correct) |
| 6b No TCP drops | status 0 on 4 threads | Known — the 23505 catch closes the connection before the losing threads receive a clean 409; functionally correct, test assertion too strict |
| 7a No auth header | Returns 400 not 401 | Test script bug — POSTs to a GET endpoint; 400 is correct behaviour |

**Current QA baseline (June 2026):** 38 PASS · 0 CRITICAL · 2 FAIL (6b + 7a — both test artefacts) · 0 SKIP

---

# 🐛 Backend Bug Patterns — /bookings/create (June 2026 Audit)

These bugs were discovered during the QA integration audit. Apply these lessons to any new or refactored parameterised SQL.

---

## Pattern 7 — Dead Parameters in pg Parameterised Queries

**Problem:** PostgreSQL's extended query protocol requires type-inference for ALL parameter slots `$1`–`$N` (where N is the highest `$N` referenced). If `$3` is passed in the values array but **not referenced** in the SQL text, PostgreSQL cannot infer its type and throws:

```
error: could not determine data type of parameter $3
```

**Classic failure (pre-existing bug in /bookings/create clash check):**
```javascript
// WRONG — booking_date passed as $3 but the SQL uses the TABLE COLUMN,
// not the parameter. PostgreSQL sees $1–$7 but $3 has no type context.
await client.query(
  `SELECT id FROM bookings.confirmed_bookings
   WHERE  COALESCE(date_from::date, booking_date) <= $5::date ...`,
  [room_id, tenantId, booking_date, date_from, date_to, start_time, end_time]
);
```

**Rule:** Every `$N` slot in the values array MUST be referenced in the SQL body with at least one type-providing cast. If a parameter is dead (never referenced), remove it from the array and renumber the remaining parameters.

```javascript
// CORRECT — booking_date removed; params renumbered $4→$3, $5→$4, $6→$5, $7→$6
await client.query(
  `SELECT id FROM bookings.confirmed_bookings
   WHERE  COALESCE(date_from::date, booking_date) <= $4::date
     AND  COALESCE(date_to::date,   booking_date) >= $3::date
     AND  start_time < $6::time
     AND  end_time   > $5::time`,
  [room_id, tenantId, date_from, date_to, start_time, end_time]
);
```

---

## Pattern 8 — AJV coerceTypes + anyOf null branch silently coerces integers

**Problem:** Fastify 4 enables `coerceTypes: true` in its AJV configuration by default. When a schema uses `anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }]` and a falsy integer like `0` is submitted, AJV fails the integer branch (minimum check), then coerces `0` to `null` to match the `{ type: 'null' }` branch. The request is **accepted** with the field silently transformed to `null`.

**Consequence:** A `guest_count: 0` booking was accepted with `guest_count: null` stored in the DB. Handler-level runtime checks that test `guest_count !== null` also failed to catch it because the value was already coerced before the handler ran.

**Rule:** Never use `anyOf: [{ type: 'integer/number', minimum: N }, { type: 'null' }]` for optional numeric fields in Fastify schemas. Use the plain type instead and let the JS destructuring default handle the absent-field case:

```javascript
// WRONG — AJV coerces 0 to null via the null branch
guest_count: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }

// CORRECT — plain integer; absent field handled by JS default (= null)
guest_count: { type: 'integer' }
// In destructuring:
const { guest_count = null } = request.body;
// Then guard at handler level:
if (guest_count !== null && guest_count !== undefined && guest_count < 1) {
  throw badRequest('guest_count must be at least 1');
}
```

---

## Pattern 9 — FOR UPDATE / Advisory Locks on FORCE RLS Tables

**Problem:** `SELECT ... FOR UPDATE` on a FORCE RLS table requires the row to pass BOTH the SELECT policy (USING clause) AND the UPDATE policy check. A `FOR ALL USING (...)` policy without a `WITH CHECK` clause is not sufficient for the UPDATE direction — PostgreSQL evaluates the USING clause as both check and WITH CHECK for `FOR UPDATE`, but the `venuedesk_app` restricted role triggers additional privilege validation that causes 500 errors.

Similarly, `pg_advisory_xact_lock` is a `pg_catalog` function. While PostgreSQL grants PUBLIC EXECUTE on most built-in functions, the `venuedesk_app` role as configured does not have access, causing 500 errors.

**Rule:** Do NOT use `FOR UPDATE` or `pg_advisory_xact_lock` in routes that run under `withTenantContext` (appPool / `venuedesk_app` role).

**Correct approach for concurrency protection (IMPLEMENTED):** Migration 022 adds a partial unique index on `confirmed_bookings(room_id, booking_date, start_time, end_time) WHERE status <> 'cancelled'`. The `/bookings/create` INSERT catches PostgreSQL error `23505` and returns 409. See Pattern 11 below for the deployment note.

---

## Pattern 10 — Deploy Sequence: SCP Before docker cp

**Problem:** The VPS deployment workflow requires two steps:
1. `scp` the local file to the VPS host path
2. `docker cp` from the VPS host path into the running container

If you skip the `scp` step and only run `docker cp`, the container receives the **old file** from the VPS host path (the file you previously SCPed), not your latest local changes. This silently deploys stale code.

**Rule:** Always run both commands in order. Never skip the SCP:

```bash
# Step 1 — update VPS host file
scp ~/Downloads/venue_desk_backup/venuedesk-api/src/routes/<file>.js \
    root@72.61.19.52:/opt/n8n_postgres/venuedesk-api/src/routes/<file>.js

# Step 2 — inject into running container
ssh root@72.61.19.52 \
  "docker cp /opt/n8n_postgres/venuedesk-api/src/routes/<file>.js \
              venuedesk-api:/app/src/routes/<file>.js && \
   docker restart venuedesk-api && sleep 6 && docker logs venuedesk-api --tail 5"
```

**Verification:** Check `docker logs` for `[server] venuedesk-api listening on port 3000` — if the log appears immediately (< 2s), the container was already running and the restart didn't take. Wait the full 6 seconds.

---

## Pattern 11 — Long-Filename SCP: Use /tmp as Relay

**Problem:** When SCP or SSH command arguments contain very long file paths (e.g. `022_confirmed_bookings_unique_slot.sql`), the Claude Code interface wraps the display text across multiple lines. If the user copy-pastes the wrapped text, a literal newline is inserted into the command, splitting it into invalid fragments — the second fragment is treated as a new shell command.

**Rule:** For any file with a path > ~80 characters, copy it to `/tmp` locally first, SCP the short path, then move on the VPS:

```bash
# Step 1 — create short local alias (runs in Claude Bash tool, no password needed)
cp ~/Downloads/venue_desk_backup/venuedesk-api/src/db/migrations/022_long_name.sql /tmp/m022.sql

# Step 2 — SCP the short path (user runs this)
scp /tmp/m022.sql root@72.61.19.52:/tmp/m022.sql

# Step 3 — move on VPS + docker cp + restart (user runs this)
ssh root@72.61.19.52 "cp /tmp/m022.sql /opt/n8n_postgres/venuedesk-api/src/db/migrations/022_long_name.sql"
ssh root@72.61.19.52 "docker cp /tmp/m022.sql venuedesk-api:/app/src/db/migrations/022_long_name.sql"
ssh root@72.61.19.52 "docker restart venuedesk-api"
```

**Why not use `--` or quoting?** The issue is display wrapping, not shell quoting. The newline is inserted at copy-paste time. The only reliable fix is keeping every command under ~90 characters.

---

## Pattern 12 — UTC-Anchored Date Guards (BST/DST Boundary Fix)

**Problem:** `new Date().toISOString().slice(0, 10)` and `new Date(dateStr)` both use the
Node.js process's local timezone when converting to/from wall-clock dates. On a VPS running
`Europe/London`, the process shifts 1 hour forward during BST. This means "today" as computed
at 23:00 UTC in summer is actually tomorrow in local time — the past-date guard rejects valid
same-day bookings made in the evening, and the 90-day ceiling miscounts by one day at DST
transition boundaries.

**Rule:** Always use `Date.UTC()` to anchor "today" and to parse date strings for duration
arithmetic. Never construct a `Date` from a bare `YYYY-MM-DD` string (implicitly local TZ).

```javascript
// ── Past-date guard ──────────────────────────────────────────────────────────
const _now    = new Date();
const todayMs = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate());
const today   = new Date(todayMs).toISOString().slice(0, 10);  // YYYY-MM-DD UTC

// ── Duration ceiling ─────────────────────────────────────────────────────────
// parseUTC: explicit UTC midnight — months are 0-indexed in Date.UTC()
const parseUTC     = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msPerDay     = 86_400_000;
const durationDays = Math.round((parseUTC(date_to) - parseUTC(date_from)) / msPerDay);
```

**Deployed:** June 2026. Confirmed by QA suite: 38 PASS · 0 CRITICAL · 0 regressions.
Both `3c` (historical date) and `3d` (3-year span) continue to return 400 correctly.

---

# ✅ Completed Security & Correctness Items (June 2026)

## 1. Race Condition — Unique Constraint on confirmed_bookings ✅ DONE

**Migration 022** (`022_confirmed_bookings_unique_slot.sql`) deployed June 2026.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_bookings_room_slot
  ON bookings.confirmed_bookings (room_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled');
```

The `/bookings/create` INSERT catches PostgreSQL `23505` (unique_violation) and converts it to HTTP 409 — the same response as a normal clash-check rejection. Verified: 5 concurrent threads → exactly 1 succeeds.

## 2. Past-Date Guard on booking_date ✅ DONE

Implemented June 2026, hardened to UTC June 2026 in `/bookings/create`:
```javascript
// Date.UTC() anchors "today" to UTC midnight — prevents BST/DST drift shifting the boundary.
const _now   = new Date();
const todayMs = Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), _now.getUTCDate());
const today   = new Date(todayMs).toISOString().slice(0, 10);  // YYYY-MM-DD UTC
const effectiveFrom = date_from || booking_date;
if (booking_date < today || effectiveFrom < today) {
  throw badRequest('Cannot create or register a venue reservation block in the past.');
}
```

## 3. Maximum Booking Duration Ceiling (90 days) ✅ DONE

Implemented June 2026, hardened to UTC June 2026 in `/bookings/create`:
```javascript
// parseUTC avoids implicit local-TZ offset; months are 0-indexed in Date.UTC().
const parseUTC     = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msPerDay     = 86_400_000;
const durationDays = Math.round((parseUTC(date_to) - parseUTC(date_from)) / msPerDay);
if (durationDays > 90) {
  throw badRequest('Booking duration exceeds maximum allowed limit of 90 days.');
}
```

---

## Pattern 13 — n8n `neverError: true` Silently Masks db-api Failures

**Problem:** n8n HTTP Request nodes that call db-api often have `neverError: true` set,
which prevents the node from failing even when the db-api returns a 400 or 500. Downstream
Code aggregator nodes then unconditionally return `{ success: true, ... }` to the frontend.
The result: the frontend shows "Saved!" while nothing was written to the database.

This was the root cause of the customer interactions silent failure (June 2026):
- Workflow called `/recurring/log-interaction` (wrong endpoint, CRFC-only) instead of
  `POST /customers/log-interaction`
- `neverError: true` swallowed the 400 validation error
- Code aggregator returned `{ success: true }` regardless
- Frontend showed success; nothing was inserted

**Rule:** When debugging a "saves but nothing appears" symptom:
1. Check the **n8n execution data** for the relevant workflow (not the frontend error state)
2. Look at the HTTP Request node's actual response body — `neverError` hides HTTP failures but the response body still contains the error
3. Verify the endpoint URL in the HTTP Request node is correct and exists in db-api
4. Check the Code aggregator — if it returns `{ success: true }` unconditionally it is masking errors

**Diagnosis pattern:**
```bash
# Check if route exists
curl -s -o /dev/null -w "%{http_code}" -X POST https://api.venuedesk.co.uk/<route>
# 404 = route missing, 401 = route exists (auth required)
```

---

## Pattern 14 — n8n Code Aggregator Double-Wrapping

**Problem:** When a Code node does `$input.all().map(i => i.json)` on the output of an HTTP
Request node that returned `{ success: true, data: [...] }`, the map produces:
```
[ { success: true, data: [...] } ]   // array of one wrapper object
```
Then wrapping that in another return: `{ success: true, data: rows }` produces:
```
{ success: true, data: [ { success: true, data: [...actual rows...] } ] }
```
The frontend reads `json.data` and gets the **wrapper object**, not the actual rows. The array
appears non-empty (length 1) so "no results" guards don't fire — the list renders garbled data.

**Rule:** Code aggregators that relay HTTP Request responses must unwrap correctly:
```javascript
// WRONG — double-wraps the db-api response
const rows = $input.all().map(i => i.json).filter(r => r && Object.keys(r).length > 0);
return [{ json: { success: true, data: rows } }];

// CORRECT — passes through the db-api data array directly
const response = $input.first().json;
const data = (response && response.data) || [];
return [{ json: { success: true, data: data } }];
```

---

## Pattern 15 — Sentinel Values in API Filter Parameters

**Problem:** Legacy code sometimes passes sentinel strings (e.g. `?email=all`) to mean
"no filter — return everything". If the db-api has no special handling for the sentinel,
it is passed literally to the SQL: `WHERE customer_email ILIKE 'all'` — which matches
nothing and returns zero rows silently.

**Example (June 2026):** `loadAllInteractions()` in `index.html` called:
```javascript
fetch(INTERACTIONS_API + '?email=all' + tidParam('&'), ...)
```
The db-api `/customers/interactions` has no `email=all` guard, so it returned 0 rows.
The Customer Interactions tab appeared permanently empty.

**Rule:** To fetch all records with no filter, simply omit the parameter entirely:
```javascript
// WRONG — sentinel treated literally by SQL
fetch(INTERACTIONS_API + '?email=all' + tidParam('&'), ...)

// CORRECT — no email param = no filter = all rows for tenant
fetch(INTERACTIONS_API + tidParam(), ...)
```
If a sentinel is ever needed for backward compatibility, handle it explicitly in the route:
```javascript
const email = request.query.email;
const emailFilter = (email && email !== 'all') ? email : null;
```

---

## Customer Interactions — Endpoint & Workflow Reference (June 2026)

### db-api endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/customers/log-interaction` | JWT | Insert a new interaction from the dashboard modal |
| `GET` | `/customers/interactions` | JWT | List interactions for a customer (by `customer_id` or `email`) |

**`POST /customers/log-interaction` body:**

| Field | Required | Notes |
|-------|----------|-------|
| `customer_id` | ✓ (UUID) | assertUUID enforced |
| `subject` | ✓ | Short title |
| `interaction_type` | ✓ | Phone Call / Email / In Person / SMS / WhatsApp / Other |
| `notes` | — | Full detail |
| `staff_member` | — | Defaults to 'Staff' |
| `booking_id` | — | UUID, nullable |
| `booking_date` | — | YYYY-MM-DD or ISO string, sliced to date |
| `room_name` | — | String |
| `customer_name/email/phone` | — | Denormalised for display without joins |

### n8n workflow

**Live workflow ID:** `WPG6q8AOrs9ooxbB` (name: "Customer Interactions API")
**Backup file:** `n8n-workflows/nW4p6cg3l7OHwjQP_clean.json`

The live ID differs from the backup filename — this is expected after re-import. The live workflow is the authoritative version; update it via n8n MCP tools for quick fixes and sync the backup file afterward.

**Webhook paths (both on `/webhook/customer-interactions`):**
- `GET` → `PG - Get Interactions` → `GET /customers/interactions`
- `POST` → `PG - Insert Interaction` → `POST /customers/log-interaction`

**Key n8n node settings:**
- Both HTTP Request nodes have `neverError: true` — errors are absorbed silently
- Auth for POST: `Authorization: Bearer $json.body?.jwt` (JWT body-tunnel from browser)
- Auth for GET: `Authorization: Bearer $env.N8N_SERVICE_JWT` (service JWT — server-to-server)

---

# ⚠️ Pending Items — Security & Correctness

## 1. Remove PostgreSQL host port binding (pre-existing)

See original pending item — `ports: "5432:5432"` in docker-compose.yml exposes PostgreSQL on the host. Remove in production.

---

# 📋 /bookings/create Route — Field Reference (Post-Audit)

| Field | Schema type | Validation | Notes |
|-------|-------------|------------|-------|
| `customer_id` | string (UUID) | assertUUID | Required |
| `room_id` | string (UUID) | assertUUID | Required |
| `booking_date` | string | DATE cast by PG; must not be in the past | Required |
| `start_time` | string | TIME cast by PG; must be < end_time | Required |
| `end_time` | string | TIME cast by PG | Required |
| `date_from` | string | Defaults to booking_date; must not be in the past; (date_to − date_from) ≤ 90 days | Optional |
| `date_to` | string | Defaults to booking_date; (date_to − date_from) ≤ 90 days | Optional |
| `status` | string enum | AJV enum: confirmed/pending/provisional/deposit_paid/cancelled/fully_paid/paid/overridden | Default: confirmed |
| `guest_count` | integer | Handler: must be >= 1 if provided; must not exceed room.capacity | Optional; null = unconstrained |
| `total_amount` | number | — | Default: 0 |
| `deposit_amount` | number | — | Default: 0 |
| `balance_due` | number | Derived: total − deposit if not provided | Optional |
| `payment_method` | string | — | Default: cash |
| `booking_request_id` | string (UUID) | assertUUID if present | Optional |
| `check_clashes` | boolean | — | Default: true; false bypasses clash check (internal use only) |

**When `check_clashes: true` (default):**
1. Past-date guard: `booking_date` / `date_from` < today → 400
2. Duration ceiling: `(date_to − date_from) > 90 days` → 400
3. `guest_count` guard: present and < 1 → 400
4. Room lookup: `SELECT id, capacity FROM bookings.rooms WHERE id = $1 AND tenant_id = $2`
5. Capacity ceiling: `guest_count > room.capacity` → 400 (skipped if `room.capacity = 0`)
6. Clash check: SQL overlap query → 409 if existing booking overlaps
7. INSERT: catches PostgreSQL `23505` (unique index violation) → 409 (second defence against race condition)

---

# 🔍 n8n Startup Diagnostics

## Startup Burst Pattern (Expected Behaviour)

When n8n restarts with many active workflows, all workflows activate simultaneously. With 28+ workflows, this causes a transient CPU spike on PostgreSQL (observed: 350% for ~60s), a brief "Database connection timed out / recovered" in n8n logs, and a flood of "Task rejected by Runner — Offer expired" messages.

**This is normal and self-resolving.** CPU returns to <1% within ~60 seconds. No workflows are lost.

**Root cause:** n8n does not stagger workflow activation on startup. All scheduling timers and trigger registrations hit the DB at once.

**"Offer expired" errors specifically:** These occur when n8n queues internal tasks (not user Code nodes) during startup before the task runner has finished initialising. Confirmed June 2026: 0 active workflows use Code nodes (`n8n-nodes-base.code`), so no user workflow execution is affected.

---

## n8n Diagnostics Cheat Sheet

**Check restart count (0 = no crashes since last manual start):**
```bash
docker inspect n8n_postgres-n8n-1 --format '{{.RestartCount}} restarts, StartedAt: {{.State.StartedAt}}'
```

**Check recent executions per workflow (use n8ndb, not n8n):**
```bash
docker exec n8n_postgres-postgres-1 psql -U n8n -d n8ndb -c \
"SELECT \"workflowId\", status, count(*) FROM execution_entity \
 WHERE \"startedAt\" > now() - interval '15 minutes' \
 GROUP BY \"workflowId\", status ORDER BY count DESC LIMIT 10;"
```

**Check for stuck running/waiting executions:**
```bash
docker exec n8n_postgres-postgres-1 psql -U n8n -d n8ndb -c \
"SELECT \"workflowId\", status, count(*) FROM execution_entity \
 WHERE status IN ('running', 'waiting') GROUP BY \"workflowId\", status;"
```

**Check active Postgres queries (flood detection):**
```bash
docker exec n8n_postgres-postgres-1 psql -U n8n -d bookings_db -c \
"SELECT pid, round(extract(epoch from now()-query_start)) AS secs, state, left(query,120) AS query \
 FROM pg_stat_activity WHERE state != 'idle' AND query_start IS NOT NULL ORDER BY secs DESC LIMIT 20;"
```

**Check which active workflows use Code nodes (task runner scope):**
```bash
docker exec n8n_postgres-postgres-1 psql -U n8n -d n8ndb -c \
"SELECT id, name FROM workflow_entity WHERE active = true AND nodes::text LIKE '%\"type\":\"n8n-nodes-base.code\"%';"
```

## Known Historical Failures (not current)

| Workflow | ID | Last error | Status |
|----------|----|------------|--------|
| Form entry workflow | `4iA8B7MCIejoTo5T` | Dec 2025 (16 errors) | Deactivated — not a live issue |
