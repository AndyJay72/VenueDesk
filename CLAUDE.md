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

### ⚠️ Root vs CommunityHub — two copies, root is live

The repo contains **two copies** of every HTML page:

| Location | Purpose | Served by |
|----------|---------|-----------|
| `/<file>.html` (repo root) | **Live production source** | GitHub Pages → `venuedesk.co.uk` |
| `CommunityHub/<file>.html` | Local working copy / backup | Not served directly |

GitHub Pages is configured to serve from the repo root. `CommunityHub/` is a backup mirror that is **not deployed**. Changes made only to `CommunityHub/` will not appear on the live site.

**Always edit both copies, or copy CommunityHub → root before committing:**

```bash
cd ~/Downloads/venue_desk_backup

# Edit the CommunityHub copy first (your working copy)
# Then promote to root before staging:
cp CommunityHub/<file>.html ./<file>.html

git add CommunityHub/<file>.html <file>.html
git commit -m "..."
git push origin main
```

**Or edit the root copy directly** — it is identical to the CommunityHub copy and is the simpler target for one-off patches:

```bash
# Edit root copy, then sync back to CommunityHub to keep them in step:
cp <file>.html CommunityHub/<file>.html
git add <file>.html CommunityHub/<file>.html
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
requested. All fixes must be vanilla JS edits to the existing `.html` files. GitHub Pages
serves from the **repo root** — always update both the root copy and the `CommunityHub/`
mirror (see Frontend deployment section). Maintain the existing dark-theme fintech CSS layout exactly.

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

## Rule F7 — localStorage vs sessionStorage Key Policy

**Problem:** Auth/identity keys written to `localStorage` persist indefinitely across browser
sessions. If a shared or public computer is used, a subsequent user can read `vp_token` from
`localStorage` and access the dashboard without logging in. Multiple pages were found writing
JWT tokens and tenant context to `localStorage` instead of `sessionStorage`.

**Rule:** Auth and identity keys MUST use `sessionStorage`. UI preference keys MAY use
`localStorage` (they are not security-sensitive and persisting across browser sessions is the
intended behaviour).

| Key | Storage | Why |
|-----|---------|-----|
| `vp_token` | **sessionStorage** | JWT — must not outlive browser session |
| `vp_user` | **sessionStorage** | User object including role/tenant |
| `vp_tenant_id` | **sessionStorage** | Tenant context |
| `vp_venue_id` | **sessionStorage** | Alias for tenant_id |
| `vp_venue_name` | **sessionStorage** | Displayed name — part of identity |
| `vp_user_name` | **sessionStorage** | Staff display name |
| `vd_admin_auth` | **sessionStorage** | Onboarding admin key gate |
| `vp_sidebar_col` | localStorage | UI preference — intentional persistence |
| `vp_theme` | localStorage | UI preference — intentional persistence |
| `vp_light_mode` | localStorage | UI preference — intentional persistence |
| `vp_sidebar_collapsed` | localStorage | UI preference — intentional persistence |

**Audit status (June 23 2026):** All live root files scanned. Every auth/identity key now
uses `sessionStorage`. UI preference keys remain in `localStorage` — this is correct.
Files confirmed clean: `index.html`, `calendar.html`, `customers.html`, `accounts.html`,
`users.html`, `admin-config.html`, `final-payment.html`, `onboarding.html`,
`manual-booking.html`, `recurring-bookings.html`.

`CommunityHub/preview/` and `CommunityHub/spa/` still contain the old pattern — these are
archive/preview files, not live, and do not need fixing.

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
- All fixes must be edits to the existing `.html` files. GitHub Pages serves from the **repo root** — always update both the root copy and the `CommunityHub/` mirror. Maintain the existing dark-theme fintech CSS layout exactly.

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

**Current QA baseline (June 27 2026):** 38 PASS · 0 CRITICAL · 2 FAIL (6b + 7a — both test artefacts) · 0 SKIP

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

## 4. admin-config.html Audit & Fixes ✅ DONE (June 2026)

Five bugs found and fixed via Playwright-verified testing session:

**a) Duplicate function block removed** — 9 functions (`roomHoursKey`, `loadRoomHours`,
`saveRoomHours`, `servicesKey`, `loadServicesData`, `saveServicesData`, `generateTimeOptions`,
`renderServicesTable`, `addService`, `editServiceItem`, `toggleService`, `deleteSvc`) were
declared twice. The second block won via hoisting; the first was dead. Removed ~110-line
duplicate, plus dead `const _origSwitchTab` line.

**b) Rule F4 claim check added to security gatekeeper** — The gatekeeper checked JWT expiry
but not missing `user_id`/`id` or `tenant_id` claims. Added stale-token guard with
`sessionStorage.clear()` + redirect. Added `return` after expiry redirect so the claim check
doesn't fire after navigation.

**c) Services UUID fix** — `addService()` generated `'svc_' + Date.now()` IDs. The db-api
`/config/services/upsert` endpoint validates UUIDs via `assertUUID`. Rejection was silently
swallowed by `.catch(() => {})`. Fixed: `crypto.randomUUID()` for IDs + surfaced errors via
`console.error` chain in `_persistSvcToDb`.

**d) Services n8n proxy bypassed** — `get-service-data` n8n webhook returned a flat single
object instead of `{data: [...]}`, so `syncServicesFromDb` always got `d.data = undefined`
and bailed early. After browser close (sessionStorage wiped), services appeared gone. Fixed:
all three service calls now go directly to `api.venuedesk.co.uk/config/services*` with
Pattern 4 JWT auth (`?jwt=` for GET, `jwt` in body for POST).

**e) Cancellation policy parallel saves** — Three sequential `await save(key, value)` calls
took 4–6s; any navigation mid-save left the policy partially written in DB. Fixed:
`await Promise.all([save(k1,v1), save(k2,v2), save(k3,v3)])` — one round-trip ~1–2s.

**f) Pricing grid × button missing after inline save** — `savePricingCell()` saved to DB and
refreshed the `pricing[]` JS array but never updated the DOM. The `del-price-btn` only
appeared after `renderPricingGrid()` ran on a full tab switch. A user who set a rate and
immediately wanted to remove it had no visible way to do so. Fixed: after a successful save,
`savePricingCell()` now checks whether the cell already has a `del-price-btn` and, if not,
creates and appends one with the correct `onclick` referencing the captured `room_id` and
`event_type_id`. `deletePricingCell` already removes the button when clicked — no further
changes needed there. Verified via Playwright: × button DOM count goes 1 → 2 after save,
cell clears and button removes on click, back to 1.

**g) Policy Templates tab — unimplemented backend built** — The UI existed but both n8n
webhooks (`get-policy-templates`, `save-policy-template`) returned 404 with no CORS headers.
All saves failed with `ERR_FAILED`. Templates always loaded empty.
Fixed end-to-end: migration 023 creates `bookings.policy_templates (tenant_id, code)` with
UNIQUE (tenant_id, code) key, RLS enforced + forced, `venuedesk_app` granted CRUD.
`GET /config/policy-templates` and `POST /config/policy-templates/upsert` added to
`config.js`. Frontend wired directly to db-api: `loadPolicyTemplates` uses `?jwt=` query
param and reads `json.data[]`; `savePolicyTemplate` sends `jwt: _TOKEN()` in body.
Verified: all three templates (A/B/C) save and reload correctly; empty-base guard works.

## 5. localStorage → sessionStorage Migration Audit ✅ DONE (June 23 2026)



Full audit of all live HTML pages (repo root) for auth/identity keys incorrectly stored in
`localStorage`. See **Rule F7** for the definitive key → storage mapping.

**Pages fixed across June 22–23 2026 sessions:**

| File | Keys migrated | Other fixes |
|------|--------------|-------------|
| `customers.html` | `vp_token`, `vp_user`, `vp_tenant_id` etc. | CORS auth pattern |
| `accounts.html` | `vp_token`, `vp_user`, `vp_tenant_id` etc. | CORS auth pattern |
| `users.html` | `vp_token`, `vp_user` | — |
| `admin-config.html` | `vp_token`, `vp_user` | — |
| `final-payment.html` | `vp_token`, `vp_user` | Added jwt+tenant_id to both fetch calls |
| `onboarding.html` | `vd_admin_auth` | Auth gate now expires on browser close |

**Pages confirmed clean (no auth-key localStorage):** `index.html`, `calendar.html`,
`manual-booking.html`, `recurring-bookings.html`, `userguide.html`.

`vp_sidebar_col`, `vp_theme`, `vp_light_mode`, `vp_sidebar_collapsed` remain in
`localStorage` — this is intentional (UI preferences, not security-sensitive).

## 6. audit-log.html — staff_member Field Drop ✅ FIXED (June 24 2026)

**Bug:** Customer interactions were correctly stored in DB with a `staff_member` value, but
the Staff column in `audit-log.html` always showed `—`. The render function checked
`t.staff_member` — but when interactions were mapped to audit events, `i.staff_member` was
read (used in the `details` string) but never copied into the pushed event object itself.

**Fix:** Added `staff_member: i.staff_member || ''` to the pushed event objects in both
the `recurring` branch and the standard `interaction` branch of the interactions mapper.
Confirmed: both `audit-log.html` root and `CommunityHub/` mirror updated (commit `a598de5`).

**General lesson:** See Pattern 20 below — when mapping a source object to an event/display
object, every field that will be rendered must be explicitly carried across. Fields used
only inside computed strings are silently dropped from the target object.

## 7. Onboarding CRM Dashboard Upgrade ✅ DONE (June 24 2026)

Full transformation of `onboarding.html` + `OnboardingManager.json` from a basic setup
utility into a Tenant Lifecycle & CRM Dashboard. Commit `76615b9`. 16/16 smoke-test checks
passed. See `# 🛠️ onboarding.html — Architecture Reference` section below for full detail.

## 8. Backend endpoints for Audit Log + Health ✅ DONE (June 24 2026)

**Migration 026** (`026_admin_audit_log.sql`) deployed June 24 2026.
Creates `bookings.admin_audit_log` and `bookings.system_health` tables.

**New db-api routes (commit `a434210`):**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health/ping` | None | Latency target for onboarding telemetry panel |
| `POST` | `/health/pulse` | Service JWT | n8n cron heartbeat → `system_health` |
| `POST` | `/admin/audit-log` | Service JWT (admin role) | n8n fan-out writes onboarding actions |
| `GET` | `/admin/system-logs` | Service JWT (admin role) | Onboarding audit modal reads |

Smoke-test results: `GET /health/ping` → `{"ok":true}` · `POST /admin/audit-log` → 400
(correct — empty body fails AJV schema before auth; n8n sends full body) · `GET /admin/system-logs` → 401.
**Next migration after 026:** `027_tenants_contact_name.sql` — see item 9 below.

**onboarding-guide.html** — new interactive super-admin HTML guide (864 lines, commit `fb360bd`).
Matches `userguide.html` design system. Includes 5 inline UI mockups, search, light/dark toggle,
13 sections, 12-term glossary. Deployed at root + CommunityHub mirror.

**Audit log graceful degradation (commit `bb8c1e8`)** — `loadSystemLogs` now reads
`r.text()` before `r.json()`, shows "not yet active" panel on empty/non-JSON response
instead of exposing raw `JSON.parse` error to user.

---

## 9. Onboarding write-node auth + contact name ✅ DONE (June 25 2026)

Three bugs diagnosed and fixed across two sessions (June 24–25 2026). Commit `48b20f3`.

**Bug A — Toggle/Create/Reset/Update returned "Empty response from n8n"**
`API: Toggle Venue` (and three sibling nodes) used `body?.admin_key` as the `X-Admin-Key`
header value. The frontend sends the plain-text key; the server env var holds a different
hash value. db-api returned 401 → n8n halted before `Respond:` node fired → empty HTTP 200
body → `_safeJSON` threw "Empty response from n8n — workflow may need re-importing".
Fix: all four write nodes now use `$env.ONBOARDING_ADMIN_KEY` exclusively (Pattern 24).
`OnboardingManager.json` re-imported into live n8n June 25 2026.

**Bug B — Venue name field name mismatch (`name` vs `venue_name`)**
`confirmEditVenue()` sent `name: venueName` in the POST body; n8n read `body?.venue_name`.
Empty string → db-api's `CASE WHEN '' THEN ... ELSE name` left venue name unchanged.
Fix: changed to `venue_name: venueName` in `onboarding.html` (commit `5be85f5`).

**Bug C — Contact name silently not saved**
`POST /update-venue` ran `UPDATE bookings.staff_users WHERE tenant_id = $2` but the live
venues had no rows in `staff_users` (only tenant_id 1 and 1001 had staff users). Zero rows
matched; no error; route returned `{ok:true}`; success toast showed; name reverted.
Fix: **migration 027** adds `contact_name TEXT` to `bookings.tenants`. Route now writes
`contact_name` into the tenants row directly (in addition to staff_users when one exists).
`GET /venues` reads `COALESCE(t.contact_name, u.full_name) AS full_name` — backward compat.
See Pattern 25.

**Playwright suite:** 60/60 passing after all fixes.

---

## 10. Multi-tenant isolation — N8N_SERVICE_JWT root cause ✅ FIXED (June 25 2026)

Commits `f99d7ec`, `1ee01ad`, `266ca62`, `0681fe5`.

**Root cause:** `N8N_SERVICE_JWT` (docker-compose env var, `tenant_id: 1001`) was used as the
`Authorization` header for every n8n → db-api HTTP Request node. Every user, regardless of
their actual tenant, received tenant 1001's data because the service JWT locked the RLS context.

**Affected workflows and fix applied:**

| Workflow file | Nodes fixed | Method |
|---|---|---|
| `hBclMCxbgmz7f3Za_clean.json` (Dashboard) | 8 read nodes | `body?.jwt` from POST body |
| `tafp1WtWgLvRY3HC.json` (Config Manager) | 13 nodes | `query?.jwt` (GET) / `body?.jwt` (POST) |
| `nW4p6cg3l7OHwjQP_clean.json` (Interactions) | PG - Get Interactions | `query?.jwt` |

All three workflows must be **re-imported into live n8n** after any changes.

**Frontend GET calls fixed** (these didn't include jwt, so n8n fell back to service JWT):

| File | Calls fixed |
|---|---|
| `index.html` | 4 × `customer-interactions` GET |
| `audit-log.html` | 1 × `customer-interactions` GET |
| `admin-config.html` | `get-rooms`, `get-event-types`, `get-pricing`, `get-settings` |
| `calendar.html` | `tidUrl()` updated — covers `get-rooms`, `get-pricing`, `get-event-types`, `blocked-dates` |
| `customers.html` | 2 × `customer-interactions` GET |

**Additional bugs fixed in the same session:**

- **PEPPER mismatch** — `onboarding.js` fallback was `'vp-pepper-change-me-in-env'`;
  `auth.js` fallback is `'vp-pepper-change-me'`. New accounts created via onboarding
  could never log in. Fixed: aligned `onboarding.js` fallback to `'vp-pepper-change-me'`.
  Any account created before this fix needs a password reset via the onboarding portal.

- **`full_name` defaulting to venue name** — `create-venue` sets `full_name = venue_name`
  if no contact name is provided. Fix: always populate the Contact Name field when creating
  a venue, or edit it afterwards in onboarding.html → the `update-venue` route writes to
  both `bookings.tenants.contact_name` AND `bookings.staff_users.full_name`. Staff must log
  out and back in after a name change for the JWT/welcome message to update.

**See Pattern 26 below.**

---

## 11. Full RLS audit & remediation ✅ DONE (June 25 2026)

Commits `88652f3`, `e557f27`.

**Rule F4 JWT claim validation added to 8 authenticated pages** — previously these pages only
checked token presence or expiry but not required claims (`user_id`, `tenant_id`). A hollow
token missing `tenant_id` would pass the gate and cause silent data failures or wrong-tenant reads.

| Page | Was | Fixed |
|------|-----|-------|
| `accounts.html` | Expiry check only | Full claim check |
| `audit-log.html` | Expiry check only | Full claim check |
| `calendar.html` | Expiry check (var syntax) | Full claim check |
| `customers.html` | Token presence only | Full claim check |
| `final-payment.html` | Token presence only | Full claim check |
| `manual-booking.html` | Token presence only | Full claim check |
| `recurring-bookings.html` | Expiry check (var syntax) | Full claim check |
| `users.html` | Expiry check only | Full claim check |

**n8n workflow service JWT fixed** — 5 workflows were using `N8N_SERVICE_JWT` (tenant_id: 1001)
for user-facing HTTP Request nodes, locking RLS context to tenant 1001 for all users:

| Workflow | n8n ID | Nodes fixed |
|----------|--------|-------------|
| Cancel Booking (Series Support) | `Cei912AKyQBPOM9j` | 4 HTTP Request nodes |
| User Manager | `KqSekNRSeXpKh5pJ` | 3 HTTP Request nodes + PEPPER fix |
| Recurring Make Booking | `FWkK7gqWxKz4funf` | 3 HTTP Request nodes |
| Cancellation Manager | `hhOxbWh7mW2tbyC5` | 2 nodes + broken node ref + broken URL expr |
| Cancel Recurring Series | `yuODHy30pR8TR1Kp` | Already correct |
| Create Recurring Booking | `XZMzXBD9ezo9ihXk` | Already correct |

**User Manager PEPPER fix** — `Code: Validate User` had `PEPPER = 'vp-pepper-change-me-in-env'`
(wrong). Changed to `'vp-pepper-change-me'` to match `auth.js`. Any account created before this
fix cannot log in — reset password via the onboarding portal.

**Get Outstanding Payments migrated off n8n Postgres node** — `index.html` and `audit-log.html`
now call `GET https://api.venuedesk.co.uk/recurring/outstanding-payments?jwt=<token>` directly.
The db-api endpoint (`recurring.js` line 2190) uses `withTenantContext` + appPool — RLS enforced.
The n8n workflow `4ZLKQsWZBgDalvok` is archived.

**Defunct workflows archived** — `ZFbEUOuAq5AVy8a5` (Add Recurring Rule) and
`fZMBcIn9LpoE9D9B` (Recurring Walk-In Booking) had no frontend callers and used direct
Postgres nodes. Both archived in n8n June 25 2026.

**Phase 2 violations after this session: 0.**

**QA suite:** 38 PASS · 0 CRITICAL · 2 FAIL (6b + 7a — pre-existing test artefacts) · 0 SKIP.
Confirmed June 25 2026.

**Playwright suite:** 60 PASS · 0 FAIL. Confirmed June 27 2026.

---

## 12. Hierarchical Space Partitioning (Parent-Child Rooms) ✅ DONE (June 27 2026)

Commit `b3d68f0`.

Enables divisible venue spaces — a "Main Hall" can be split into halves, thirds, or quarters
that each retain independent rates, operating hours, and booking calendars.

### Schema — migration 028

```sql
-- bookings.rooms
ADD COLUMN parent_room_id  UUID REFERENCES bookings.rooms(id) ON DELETE SET NULL
ADD COLUMN partition_order INTEGER   -- 0-based position within siblings
ADD COLUMN partition_total INTEGER   -- total equal parts: 2 = halves, 3 = thirds, 4 = quarters
```

Constraints: `chk_no_self_parent` (id ≠ parent_room_id), `chk_partition_consistency`
(both fields null together, or both valid with 0 ≤ order < total ≥ 2).
Index: `idx_rooms_parent_room` on `parent_room_id WHERE NOT NULL`.

### Conflict resolution — recursive CTE

All four clash-check paths (`/bookings/create`, `/bookings/check-clashes`,
`/bookings/clash-guard`, `/bookings/check-availability`) now run a `WITH RECURSIVE`
`conflict_set` CTE before querying `confirmed_bookings`. The conflict set for any
target room includes:

- **Ancestors** — parent → grandparent (booking a child blocks the parent)
- **Descendants** — children → grandchildren (booking a parent blocks all children)
- **Overlapping siblings** — siblings whose fractional footprint `[order/total, (order+1)/total]`
  intersects the target's footprint, using integer cross-multiplication to avoid float drift:

```sql
(s.partition_order * t.partition_total) < (t.partition_order + 1) * s.partition_total
AND
(t.partition_order * s.partition_total) < (s.partition_order + 1) * t.partition_total
```

This allows "2nd Half" and "3rd Quarter" (which physically overlap [0.5, 0.75]) to
correctly block each other, while "1st Half" and "3rd Quarter" (non-overlapping) can
be booked simultaneously.

### Frontend — admin-config.html

- **Add Room form**: "Parent Room / Anchor Space" collapsible section with Parent Room
  dropdown + hidden Partition row (Position + Divide Into selectors). Position options
  regenerate when Divide Into changes (Halves/Thirds/Quarters → 2/3/4 options).
- **Edit Room modal**: same section injected into dynamically-generated HTML, parent
  dropdown excludes the room being edited (prevents self-parent cycles).
- **Rooms table**: parent rooms show a "N partition(s)" badge; child rooms show
  `⊢ Parent Name · Nth Half/Third/Quarter` sub-label under the room name.
- **`populateParentDropdown(selectId, excludeId)`**: rebuilds the dropdown after
  every `loadRooms()` call so new rooms appear immediately.

### API — config.js

`GET /config/rooms` returns `parent_room_id`, `partition_order`, `partition_total`.
`POST /rooms/create` and `POST /rooms/update` accept and persist all three.
`partition_order` uses `?? null` (not `|| null`) everywhere — 0 is a valid position.

### Test results (June 27 2026)

| Suite | Result |
|---|---|
| QA integration | 38 PASS · 0 CRITICAL — no regressions |
| Playwright | 60/60 |
| Halves e2e | 7/7 |
| Thirds isolation | 5/5 |
| Quarters isolation | 6/6 |
| Cross-level thirds × quarters | 10/10 |

**Total hierarchy e2e: 28/28.** Verified: ancestor blocked by descendant, sibling overlap
detected by integer formula, non-overlapping siblings bookable simultaneously at all
granularities (halves/thirds/quarters and cross-level combinations).

---

## Pattern 27 — Recursive CTE Hierarchy Clash Check

**Pattern:** When a booking table needs tree-aware conflict detection (parent/child/sibling
rooms), define a `WITH RECURSIVE conflict_set(id)` CTE at the top of the clash query and
JOIN it to `confirmed_bookings` instead of filtering by a single `room_id`.

**Integer overlap test for fractional siblings** (avoids floating point drift):
```sql
-- Target t covers [t.order/t.total, (t.order+1)/t.total]
-- Sibling s covers [s.order/s.total, (s.order+1)/s.total]
-- They overlap iff both cross-products hold:
(s.partition_order * t.partition_total) < (t.partition_order + 1) * s.partition_total
AND
(t.partition_order * s.partition_total) < (s.partition_order + 1) * t.partition_total
```

**Tenant isolation in CTEs:** When CTEs query `bookings.rooms` inside a `systemQuery`
context (which bypasses RLS), add explicit `AND tenant_id = $N` to the seed row of each
CTE. In `withTenantContext` (appPool with RLS active), RLS handles isolation automatically
but explicit filters are still good practice.

**`check-availability` variant:** This endpoint identifies the room by name (`ILIKE $1`)
not UUID. Add a non-recursive `target_room` CTE as the first step to resolve name → id,
then seed `ancestors`, `descendants`, and `overlapping_siblings` from it.

**`partition_order` coalescing:** Always use `?? null` not `|| null` for partition fields.
`0` is a valid order value (1st partition) and `0 || null` evaluates to `null`.

---

## Pattern 20 — Event Object Mapping: Carry Every Rendered Field Explicitly

**Problem:** When a source data object (`i`) is mapped to a display/event object pushed
into an array, fields that are only *read* (e.g. used inside a computed string like
`evDetails`) are not automatically present on the target object. Any renderer that later
checks `t.field` will see `undefined`, not the source value.

**Classic failure (June 24 2026):**
```javascript
// i.staff_member EXISTS in the interaction data from the API
evDetails = i.subject || `${itype} · ${i.staff_member}`;  // staff_member read here...

events.push({
    type: evType, ts: i.timestamp,
    customer_name: i.customer_name,
    details: evDetails,
    // staff_member NEVER COPIED — silently absent from the event object
});

// Renderer:
const actorName = t.staff_member || t.actor || '';  // always '' — field missing
```

**Rule:** When building an event/display object from a richer source, explicitly list every
field that any downstream renderer, filter, or CSV export will read:
```javascript
events.push({
    type: evType, ts: i.timestamp,
    customer_name: i.customer_name,
    details: evDetails,
    staff_member: i.staff_member || '',   // ← explicit carry-through
    room_name: i.room_name,
    // ... all other rendered fields
});
```

**Diagnostic:** If a column is always blank despite the DB having data, check whether the
field is present in the *source* object but missing from the *event* object pushed to the
display array. `console.log(events[0])` immediately reveals absent keys.

---

## Pattern 21 — VPS Docker Deploy: Shell Variable for Long Paths

**Problem:** `docker cp` commands to `/opt/n8n_postgres/venuedesk-api/src/...` are 100–130
characters. Claude Code's UI and most terminals display-wrap lines longer than ~80 chars.
When a user copies a wrapped command, the display linebreak becomes a real newline — the
shell receives two broken fragments, both fail. This caused repeated deploy failures on
June 24 2026 across multiple attempts (heredoc, direct paste, scp relay).

**Rule:** When issuing `docker cp` commands on the VPS, set a path variable first, then
use it to shorten each command to under 80 characters:

```bash
S=/opt/n8n_postgres/venuedesk-api/src
docker cp $S/routes/admin.js  venuedesk-api:/app/src/routes/admin.js
docker cp $S/routes/health.js venuedesk-api:/app/src/routes/health.js
docker cp $S/server.js        venuedesk-api:/app/src/server.js
```

For migration files with long names (Pattern 11), copy to `/tmp/x` first:
```bash
cp 026_admin_audit_log.sql /tmp/x
docker cp /tmp/x venuedesk-api:/app/src/db/migrations/026_admin_audit_log.sql
```
(`/tmp/x` as source → 79 chars — just fits.)

**For long URLs** (e.g. `wget` from GitHub raw), use the same variable pattern:
```bash
U=https://raw.githubusercontent.com/AndyJay72/VenueDesk/main
wget -q $U/venuedesk-api/src/db/migrations/026_admin_audit_log.sql
```

**Root cause of wrapping:** The issue is in the Claude Code UI rendering, not the VPS
terminal. Commands that are single logical lines in my output get display-wrapped by the
UI, and copy-paste captures the visual newline as a real `\n`. Keeping commands under 80
chars is the only reliable prevention.

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

## Pattern 16 — n8n Proxy Shape Mismatch (Silent Data Loss)

**Problem:** n8n webhook proxies that sit between the frontend and db-api can return the
wrong response shape without any visible error. The proxy appears to work (HTTP 200) but
the frontend receives a flat object `{id, name, ...}` instead of `{data: [...]}`, so any
code doing `d.data || []` silently gets an empty array and bails early.

**Example (June 2026):** The `get-service-data` n8n webhook proxied
`GET /config/services` on db-api. The proxy was returning a single flat service object
instead of the expected `{data: [{...}, {...}]}`. `syncServicesFromDb` did:
```javascript
const apiSvcs = d.data || [];   // d.data = undefined → []
if (!apiSvcs.length) return;    // always returned early
```
Services lived only in sessionStorage. After a browser close (sessionStorage wiped),
services appeared gone even though they were persisted in DB. Logout/login survived
because `logout()` only removes `vp_token` — not the service sessionStorage key.

**Root cause diagnostic:** compare `curl <n8n-webhook-url>` vs
`curl <db-api-url>?jwt=<token>` and diff the shapes. If they differ, the proxy is broken.

**Rule:** When a db-api route already exists for a feature, call it directly from the
frontend rather than proxying through n8n:

```javascript
// WRONG — routes through n8n proxy that may return wrong shape
getServices: BASE + '/get-service-data',

// CORRECT — call db-api directly with Pattern 4 jwt auth
getServices: DB_API + '/config/services',
// GET:  fetch(API.getServices + '?jwt=' + encodeURIComponent(_TOKEN()))
// POST: body: JSON.stringify({ ...payload, jwt: _TOKEN() })
```

**When n8n proxy is unavoidable:** validate the shape explicitly and log a console.error
if it doesn't match expectations rather than silently returning `[]`.

---

## Pattern 17 — Frontend ID Generation: crypto.randomUUID()

**Problem:** Frontend code that generates IDs with `'prefix_' + Date.now()` produces
strings like `svc_1782068760572`. db-api endpoints that validate UUIDs (via `assertUUID`)
reject these with `INTERNAL_ERROR: id must be a valid UUID`. The rejection is typically
swallowed by a `.catch(() => {})`, so the write appears to succeed locally (sessionStorage
updated) but never reaches the DB.

**Classic failure (June 2026):** `addService()` used `id: 'svc_' + Date.now()`.
The `save-service` webhook (and later `/config/services/upsert`) both require a valid UUID.
Services were sessionStorage-only — lost on browser close.

**Rule:** Always use the native Web Crypto API for IDs sent to db-api:
```javascript
// WRONG — fails UUID validation at db-api
const newSvc = { id: 'svc_' + Date.now(), name, type, price, active: true };

// CORRECT — valid UUID accepted by assertUUID
const newSvc = { id: crypto.randomUUID(), name, type, price, active: true };
```
`crypto.randomUUID()` is available in all modern browsers and Node.js 15+. No import needed.

---

## Pattern 18 — Always Check `res.ok` Before Showing a Success Toast

**Problem:** `fetch()` does not throw on HTTP error responses (4xx/5xx). Calling it without checking `res.ok` means a failed network mutation — an n8n webhook returning 500, or a db-api route returning 400 — still runs the success toast and the follow-up `loadRooms()` / `loadEventTypes()` call. The user sees "Room deactivated" while the DB is unchanged.

This was found on four functions in `admin-config.html` during the June 2026 catch-hardening audit: `softDeleteRoom`, `restoreRoom`, `softDeleteEventType`, `restoreEventType`.

**Rule:** Every mutating `fetch()` call (POST, PUT, PATCH, DELETE) must check `res.ok` before declaring success. Extract the error body for the toast message:

```javascript
// WRONG — success toast fires even when n8n returns 500
await fetch(API.deleteRoom, { method: 'POST', ... });
showToast('Room deactivated');

// CORRECT — error body propagated to user
const res = await fetch(API.deleteRoom, { method: 'POST', ... });
if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || e.message || 'Deactivate failed');
}
showToast('Room deactivated');
```

The same pattern applies to the catch clause — prefer `showToast(e.message || 'Fallback text', 'error')` over generic `showToast('Error', 'error')` so the server's error message reaches the user.

---

## Pattern 19 — Room Hours: DB Persistence + Full-Stack Enforcement (June 2026)

### Phase 1 — DB persistence (migration 024, June 22 2026)

**Problem:** Room open/close times were stored in `sessionStorage` under `vp_room_hours_<tenant_id>`. Three helper functions (`roomHoursKey`, `loadRoomHours`, `saveRoomHours`) wrote to and read from this key. The data was lost on every browser close.

**Fix:** Migration 024 adds `open_time` and `close_time` TIME columns to `bookings.rooms`. `GET /config/rooms`, `POST /config/rooms/create`, and `POST /config/rooms/update` include these columns. The frontend sends them in the payload and reads them from the API response. `roomHoursKey`, `loadRoomHours`, `saveRoomHours` deleted — zero references remain.

**Time format note:** PostgreSQL returns TIME as `"08:00:00"` (HH:MM:SS). Frontend slices to 5 chars for the `HH:MM` dropdowns.

### Phase 2 — NULL defaults + enforcement (migration 025, June 22 2026)

**Problem with 024 defaults:** Migration 024 used `DEFAULT '08:00:00'/'17:00:00'`. All existing rooms got `close_time = 17:00:00`, which would have immediately blocked all evening bookings on enforcement.

**Migration 025 fix:**
- `ALTER COLUMN open_time/close_time SET DEFAULT NULL` — new rooms without explicit hours are unconstrained
- `UPDATE bookings.rooms SET open_time=NULL, close_time=NULL WHERE open_time='08:00:00' AND close_time='17:00:00'` — resets rooms carrying the 024 placeholder; rooms explicitly configured by a manager (different values) are left untouched

**`config.js` fix:** Create now stores `open_time || null` (was `|| '08:00:00'`). Update uses `open_time !== undefined ? (open_time || null) : current.open_time` — blank select field clears to NULL rather than triggering a `::time` cast error.

**`bookings.js` enforcement:** Room SELECT now fetches `open_time, close_time`. After capacity check, if either column is NOT NULL:
```javascript
const toHHMM = t => String(t).slice(0, 5);
if (room.open_time  && start_time.slice(0,5) < toHHMM(room.open_time))
  throw badRequest(`This room does not open until ${toHHMM(room.open_time)}. ...`);
if (room.close_time && end_time.slice(0,5)   > toHHMM(room.close_time))
  throw badRequest(`This room closes at ${toHHMM(room.close_time)}. ...`);
```
Returns HTTP 400. NULL = unconstrained (venue-wide window applies). Comparison is HH:MM zero-padded string — lexicographic == chronological.

**`calendar.html` UX layer:**
- `_getRoomWindow(roomName)` — looks up room in `qbRoomsData`; returns `{open, close}` in minutes using DB hours when NOT NULL, falls back to `VENUE_OPEN_MINS`/`VENUE_CLOSE_MINS` (08:00/22:00) when NULL
- `qbCheckAvailability` — checks per-room window before calling the server; shows "This room does not open until HH:MM" / "closes at HH:MM" in the availability box
- `_isDayFull(intervals, roomName)` and `_findNextSlot(dateStr, roomName)` — both use `_getRoomWindow`; day-full colouring and next-slot suggestions respect per-room hours

**Note on error code:** Hours violations return HTTP 400 with the correct human-readable message. The JSON `code` field shows `INTERNAL_ERROR` due to how the error handler classifies non-AJV `badRequest()` throws from inside `withTenantContext` — this is a pre-existing code-mapping quirk in `errorHandler.js`, not a regression. HTTP status is correct.

**Data flow:** browser → n8n (full `$json.body` passthrough) → db-api `/config/rooms/create|update` → `bookings.rooms.open_time / close_time`.

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

# 🛠️ admin-config.html — Architecture Reference (June 2026)

**File:** `CommunityHub/admin-config.html` | **Deployed via:** GitHub Pages

## API routing per tab

| Tab | Backend | Endpoints |
|-----|---------|-----------|
| Rooms | n8n webhook | `get-rooms`, `create-room`, `update-room`, `delete-room` |
| Event Types | n8n webhook | `get-event-types`, `create-event-type`, `update-event-type`, `delete-event-type` |
| Pricing Grid | n8n webhook | `get-pricing`, `set-pricing`, `delete-pricing` |
| Settings (buffer) | n8n webhook | `get-settings`, `update-setting` |
| Services | **db-api direct** | `GET /config/services`, `POST /config/services/upsert`, `POST /config/services/delete` |
| Cancellation Policy | n8n webhook | `update-setting` (3× per save, now parallel) |
| Policy Templates | **db-api direct** | `GET /config/policy-templates`, `POST /config/policy-templates/upsert` |
| Payments | **db-api direct** | `POST /admin/payment-settings/load`, `POST /admin/payment-settings/save` |

Services, Policy Templates, and Payments call db-api directly — all others go via n8n. See Pattern 16 for why Services was moved (same reasoning applied to Policy Templates).

## Auth patterns in this file

- **n8n webhook GETs:** `?tenant_id=<tid>` query param via `tidParam()`
- **n8n webhook POSTs:** `withRole({...payload})` helper — injects `tenant_id` + `userRole` into body
- **db-api GETs:** `?jwt=<token>` query param via `encodeURIComponent(_TOKEN())`
- **db-api POSTs:** `jwt: _TOKEN()` in request body (Pattern 4 / Rule F6)

## Services persistence flow

```
addService()
  → crypto.randomUUID()          // valid UUID for db-api
  → saveServicesData(svcs)       // sessionStorage (immediate display)
  → _persistSvcToDb(svc)         // fire-and-forget: POST /config/services/upsert?jwt=

switchTab('services')
  → syncServicesFromDb()         // GET /config/services?jwt= → { success, data: [...] }
  → merges DB rows with local-only sessionStorage entries
  → renderServicesTable()
```

After browser close: sessionStorage is empty → `syncServicesFromDb` repopulates from DB on next Services tab open.

## Cancellation policy save

`saveCancellationPolicy()` fires all three setting keys in parallel:
```javascript
await Promise.all([
    save('cancel_full_refund_days',    fullDays),
    save('cancel_partial_refund_days', partDays),
    save('cancel_partial_refund_pct',  pct),
]);
```
One round-trip (~1–2s) rather than three sequential calls (4–6s). Button spinner stays active until `Promise.all` resolves.

## Bugs fixed June 2026

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Duplicate function block | 9 functions declared twice (second block won via hoisting) | Removed ~110-line duplicate block |
| Missing Rule F4 claim check | Security gatekeeper checked expiry but not `user_id`/`tenant_id` | Added stale-claim guard with `sessionStorage.clear()` + redirect |
| Services not persisted to DB | `svc_` + timestamp IDs failed UUID validation silently | `crypto.randomUUID()` + error surfacing in `.catch` |
| Services vanish after browser close | n8n `get-service-data` proxy returned flat object; `d.data` always undefined | Bypassed n8n proxy; now calls db-api `/config/services` directly |
| Cancellation policy partially saved | 3 sequential `await save()` calls; page reload aborted in-flight requests | `Promise.all([...])` makes saves atomic from the UI's perspective |
| Pricing grid × button missing after save | `savePricingCell()` refreshed JS array but not DOM; × only appeared after tab switch | Inject `del-price-btn` into the cell immediately after successful save |
| Policy Templates tab non-functional | n8n `get-policy-templates` / `save-policy-template` webhooks never existed (404 + no CORS headers) | Built `bookings.policy_templates` table (migration 023) + `/config/policy-templates` GET+upsert routes; wired frontend to db-api directly |
| Muted catch blocks — false success toasts | `softDeleteRoom`, `restoreRoom`, `softDeleteEventType`, `restoreEventType` called `fetch()` without checking `res.ok`; success toast fired even on n8n error | Added `res.ok` guard + error message from server propagated into toast on all four functions |
| Silent load failures | `loadPricing`, `syncServicesFromDb`, `loadPolicyTemplates`, `loadPaymentSettings` all had empty/comment-only catch blocks — failures invisible to devs and users | Added `console.error` to all four; `loadPricing` also renders a visible error banner in the grid |
| `_persistSvcToDb` silent DB failure | Fire-and-forget service persist logged `console.error` on failure but showed nothing to the user | Escalated to `showToast('Service saved locally but failed to reach database', 'error')` |
| Room open/close hours — sessionStorage-only data loss | `vp_room_hours_<tid>` written to sessionStorage only; lost on every browser close; never reached DB | Migration 024 adds `open_time`/`close_time` TIME columns to `bookings.rooms`; create/update routes accept and persist them; frontend reads from API response; `roomHoursKey`, `loadRoomHours`, `saveRoomHours` deleted |

## Migration 024 Regression Test — All Green (June 22 2026)

Full regression suite run post-deployment. 11/11 checks passed.

### API results

| Test | HTTP | Verdict |
|------|------|---------|
| `GET /config/rooms` — `open_time`/`close_time` present | 200 | ✅ |
| Existing rooms carry default `08:00:00`/`17:00:00` | 200 | ✅ |
| `POST /config/rooms/create` with explicit hours | 200 | ✅ `open_time: "09:00:00"`, `close_time: "21:00:00"` stored and returned |
| `POST /config/rooms/update` — valid hours roundtrip | 200 | ✅ `"09:30"` → stored as `"09:30:00"` |
| No auth token | 401 | ✅ |
| Non-existent room UUID | 404 | ✅ `NOT_FOUND` before hitting UPDATE SQL |
| Malformed time string (`"not-a-time"`) | 500 | ⚠️ see note below |

**Malformed time string note:** PostgreSQL's `::time` cast fails at runtime, returning `INTERNAL_ERROR` rather than a 400 validation error. The AJV schema validates `open_time: { type: 'string' }` only — not the time format. **Not a regression and not reachable from the browser** — both inputs are `<select>` dropdowns, so only valid `HH:MM` values can be submitted. Low-priority hardening: add a `/^([01]\d|2[0-3]):[0-5]\d$/` regex check to the route handler if a REST consumer (Postman, scripts) needs clean 400s on bad time strings.

### Frontend integrity

Zero occurrences of `vp_room_hours_`, `loadRoomHours`, `saveRoomHours`, `roomHoursKey`, `rh.open`, `rh.close`, `rh2` across `admin-config.html`, `calendar.html`, and `index.html`.

### Cross-tab isolation confirmed

`calendar.html` has **zero references** to `open_time`, `close_time`, or `vp_room_hours`. Availability slot calculations use `VENUE_OPEN_MINS = 8*60` and `VENUE_CLOSE_MINS = 22*60` — hardcoded venue-wide constants, independent of per-room DB hours. This is intentional: per-room `open_time`/`close_time` are informational fields displayed in the admin Rooms table; the calendar booking window is governed by the venue-wide constants in CLAUDE.md Section 5. No calendar regression possible.

`index.html` has zero references to room hours of any kind.

---

## Payments tab — verified working (June 22 2026)

Full Playwright + live API verification. All paths confirmed correct:

**Load flow (`POST /admin/payment-settings/load`):**
- Fires when `switchTab('payments')` is called via the late-patch `window.switchTab` wrapper
- Returns `{ is_stripe_enabled, stripe_publishable_key, has_secret_key (bool), has_webhook_secret (bool), bacs_account_name, bacs_sort_code, bacs_account_number }`
- Secret values are **never returned in full** — only boolean presence flags (`has_secret_key`, `has_webhook_secret`)
- Status badges update from these flags: green "saved ✓" when `true`, grey "not set" when `false`

**Save flow (`POST /admin/payment-settings/save`):**
- Dynamically builds SET clause — only fields explicitly present in the body are updated
- Empty string for `stripe_secret_key` / `stripe_webhook_secret` → **skipped** (keys left unchanged in DB)
- After Stripe save: secret key + webhook input fields are **cleared** client-side; `loadPaymentSettings()` re-fires to refresh badges
- No-op body (just `jwt`) → `{ message: "Nothing to update" }` — returns 200, no DB write
- Extra/unknown fields stripped silently by `removeAdditional: true` (Fastify AJV default) — not a security risk

**Auth:** Both endpoints use `preHandler: [fastify.authenticate]` + Pattern 4 (jwt in body). No CORS header required from browser.

**Known minor issues (not fixed — low priority):**
- `toggleVis()` sets `ico.className` with a trailing space: `` `fa-solid fa-eye${...} ` `` — harmless in all browsers
- `switchTab` is late-patched in a `DOMContentLoaded` listener; if a future script wraps `window.switchTab` after this listener, `loadPaymentSettings` won't fire. No other script currently does this.

---

# 🧾 final-payment.html — Page Reference (June 23 2026)

**File:** `final-payment.html` (root) + `CommunityHub/final-payment.html` (mirror)
**Purpose:** Staff-facing balance collection page — loads outstanding invoices, allows partial or full payment recording.

## Auth pattern

Uses `_FP_*` helper constants at top of `<script>` block:
```javascript
const _FP_TID   = () => sessionStorage.getItem('vp_tenant_id') || '0';
const _FP_TOKEN = () => sessionStorage.getItem('vp_token') || '';
const _FP_STAFF = () => sessionStorage.getItem('vp_user_name') || 'Staff';
const _FP_UID   = () => { try { const u=JSON.parse(sessionStorage.getItem('vp_user')||'{}'); return u.id||u.user_id||null; } catch(e) { return null; } };
```

## n8n webhooks

| Direction | URL | Auth |
|-----------|-----|------|
| GET outstanding invoices | `n8n.srv1090894.hstgr.cloud/webhook/get-outstanding-bookings` | `?tenant_id=<tid>&jwt=<token>` query params |
| POST pay balance | `n8n.srv1090894.hstgr.cloud/webhook/pay-balance` | `jwt` + `tenant_id` in POST body |

Both webhooks go to n8n (not db-api). Apply Pattern 4 body-tunnel for jwt because the browser cannot send `Authorization` headers cross-origin.

## Security gatekeeper
```javascript
if (!sessionStorage.getItem('vp_token')) { window.location.href = 'login.html'; }
```
Add the full Rule F4 JWT claim validation IIFE if this page is hardened further.

---

# ⚠️ Pending Items — Security & Correctness

## 1. Remove PostgreSQL host port binding (pre-existing)

See original pending item — `ports: "5432:5432"` in docker-compose.yml exposes PostgreSQL on the host. Remove in production.

---

## 2. Tenant Lifecycle & CRM Dashboard ✅ DONE (June 24 2026)

Delivered in commit `76615b9`. See `# 🛠️ onboarding.html — Architecture Reference` below.

---

# 🛠️ onboarding.html — Architecture Reference (June 24 2026)

**File:** `onboarding.html` (root) + `CommunityHub/onboarding.html` (mirror)
**Workflow:** `n8n-workflows/OnboardingManager.json` (v3, commit `76615b9`)
**Auth gate:** `vd_admin_auth` in sessionStorage (not a JWT — separate admin key system)
**User guide:** `onboarding_users_guide.md` (root of repo)

## Auth model

`onboarding.html` uses its own admin key gate, separate from the vp_token JWT system:
- Login POSTs `{ admin_key }` to `N8N + /onboarding/login` → db-api validates key
- On success: `sessionStorage.setItem('vd_admin_auth', '1')` gates the UI
- All subsequent fetch calls embed `admin_key: AUTH` in the request body (Rule F6 — no Authorization header)
- Session ends on browser close (sessionStorage). Re-login required each session.

`AUTH` constant (`'vp-api-2026-Kj9mXqR4wZ'`) is visible in browser source — intentional for
this admin-only utility. Never use this key as a JWT replacement in the main app pages.

## Constant declaration order (Rule F1)

```javascript
const DASH_DB_API = 'https://api.venuedesk.co.uk';           // line 1187
const N8N         = 'https://n8n.srv1090894.hstgr.cloud/webhook'; // line 1188
const AUTH        = 'vp-api-2026-Kj9mXqR4wZ';               // line 1190
```

All three must remain at the top of the `<script>` block before any derived URLs or functions.

## Telemetry panel

| Element | ID | Data source | Update cadence |
|---------|-----|-------------|----------------|
| DB Health dot | `#dbHealthDot` | Set by `loadVenues()` success/fail | On every venue load |
| DB Health text | `#dbHealthVal` | Same as above | On every venue load |
| API Latency | `#teleLatency` | `performance.now()` round-trip to `GET /health/ping` | Every 30s via `setInterval` |
| Last Check | `#teleLastCheck` | Timestamp set after each `checkLatency()` call | Every 30s |

`startLatencyMonitor()` is called on both auto-login (checkAuth IIFE) and manual login.

## Seat Stepper + Pricing

```javascript
function adjustSeats(elId, delta)          // clamped 1–20
function updatePricingPreview(elId)        // called by adjustSeats + openEditModal
// formula: total = 30 + Math.max(0, seats - 1) * 5  — pure integer, no float drift
```

Stepper IDs: `fSeats` (create form), `editSeats` (edit modal).
`max_users` is sent in the payload for both create and edit operations.
Edit modal pre-fills from `v.max_users || v.max_seats || 1` when opened.

## Subscription CRM columns

Rendered in `renderVenues()` from fields returned by `GET /onboarding/venues`:

| Field | Badge | Fallback |
|-------|-------|---------|
| `v.subscription_status === 'active'` | `.badge-sub-active` (green) | `—` |
| `v.subscription_status === 'past_due'` | `.badge-sub-pastdue` (red) | `—` |
| `v.subscription_status === 'trial'` | `.badge-sub-trial` (indigo) | `—` |
| `v.max_users` / `v.active_users` | `Seats: X / Y` pill | `—` |

All four degrade gracefully to `—` if the db-api doesn't yet return those fields.

## System Audit Modal

Fetches `GET N8N + '/onboarding/system-logs?admin_key=<AUTH>'` (query param, Rule F6 GET pattern).
n8n proxies to `GET /admin/system-logs` on db-api using service JWT (server-to-server hop).
Renders: Timestamp / Action / Target Tenant / Admin / Details grid.

## OnboardingManager.json v3 — Webhook inventory

| Webhook path | Method | db-api endpoint | Auth |
|-------------|--------|-----------------|------|
| `onboarding/login` | POST | `POST /onboarding/login` | `admin_key` in body |
| `onboarding/venues` | GET | `GET /onboarding/venues` | `X-Admin-Key` header |
| `onboarding/create-venue` | POST | `POST /onboarding/create-venue` | `X-Admin-Key` header |
| `onboarding/reset-password` | POST | `POST /onboarding/reset-password` | `X-Admin-Key` header |
| `onboarding/toggle-venue` | POST | `POST /onboarding/toggle-venue` | `X-Admin-Key` header |
| `onboarding/update-venue` | POST | `POST /onboarding/update-venue` | `X-Admin-Key` header |
| `onboarding/system-logs` | GET | `GET /admin/system-logs` | Service JWT (Authorization header) |

## Audit fan-out pattern (v3)

After each write operation, an audit HTTP node fires **in parallel** with the Respond node:

```
API: Create Venue → [Respond: Created, Code: Lead Converted Stub, Audit: Create Venue]
API: Reset Password → [Respond: Reset OK, Audit: Reset Password]
API: Toggle Venue  → [Respond: Toggle OK, Audit: Toggle Venue]
```

All audit nodes POST to `https://api.venuedesk.co.uk/admin/audit-log` with:
```json
{ "admin_id": "super-admin", "target_tenant": <int>, "action_type": "<string>", "timestamp": "<ISO>", "details": "<string>" }
```
Auth: `Authorization: Bearer $env.CYCLE_SWEEP_SERVICE_JWT` (server-to-server — correct per Pattern 4).

## Health Pulse Cron

`Cron: Health Pulse` — schedule `*/5 * * * *` → `POST https://api.venuedesk.co.uk/health/pulse`
Auth: service JWT. db-api commits telemetry snapshot to `bookings.system_health` index.

## Known constraints / future work

- `subscription_status`, `max_users`, `active_users` columns will show `—` until db-api
  `/onboarding/venues` returns those fields. Frontend is ready; backend schema update pending.
- ~~`GET /admin/system-logs`, `POST /admin/audit-log`, `POST /health/pulse` not yet built~~
  **✅ Deployed June 24 2026** — migration 026, `health.js`, updated `admin.js`.
- Admin ID is hardcoded as `"super-admin"` in audit payloads. Replace with actual admin
  identity once the onboarding login flow returns a user record from db-api.
- ~~**Re-import required:** `OnboardingManager.json` must be re-imported~~
  **✅ Re-imported June 25 2026** — `onboarding/system-logs` webhook active; all write
  nodes now use `$env.ONBOARDING_ADMIN_KEY` (Pattern 24).

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

---

# 🧪 Playwright UI Test Harness — onboarding.html

**Script:** `tests/playwright/onboarding.spec.js`
**Config:** `tests/playwright/playwright.config.js`

All n8n / db-api network calls are mocked via `page.route()` so the suite runs offline and deterministically. A Python HTTP server spins up automatically on port 7171 serving the repo root.

## Running the suite

```bash
cd tests/playwright
npm install
npx playwright install chromium   # first run only
npm test                          # headless
npm run test:headed               # headed (watch mode)
npm run test:ui                   # Playwright UI explorer
```

Exit codes: `0` = all pass, `1` = failures.

**Current baseline (June 27 2026):** 60 PASS · 0 FAIL — confirmed after hierarchical room partitioning feature (no regressions)

## Test sections

| # | Section | Tests |
|---|---------|-------|
| 1 | Login gate | Overlay shown, wrong key rejected, correct key → app loads, Enter key works |
| 2 | Telemetry panel | All indicators present, DB health dot green, audit button, ping button |
| 3 | Stats cards | Total / Active / Inactive / Users populated correctly |
| 4 | Venues table | Column headers, row count, all 3 subscription badge types, seats pill, action buttons, empty state |
| 5 | Create form & seat stepper | All fields, stepper pricing (£30 + £5/seat), floor/ceiling clamps (1–20), slug auto-fill, tenant ID suggestion, validation errors |
| 6 | Edit modal | Pre-fills venue data, seat stepper, cancel/save |
| 7 | Password modal | Reset mode, short-password error, success closes modal |
| 8 | System Audit modal | Opens, loads records, empty state, graceful degradation on empty/non-JSON body, click-outside close, refresh |
| 9 | Venue detail panel | Opens on row click, metadata fields, status badge, 6 launch buttons, close |
| 10 | Toggle venue | Deactivate confirm→toast, reactivate→success, dismiss does nothing |
| 11 | Enquiry link copy | Button count, clipboard copy + success toast |
| 12 | Sidebar navigation | All nav links, active class, dashboard href, collapse toggle |
| 13 | Topbar & refresh | Card refresh reloads venues, topbar refresh icon, logout clears session |

## Mock helper — `mockN8N(page)`

Registered once per test via the `mockN8N(page)` helper (catches `**/n8n.srv1090894.hstgr.cloud/webhook/**`):

| Intercepted path | Returns |
|-----------------|---------|
| `/onboarding/login` | `{ ok: true, user: { username: 'admin' } }` |
| `/onboarding/venues` | 3 mock venues (active + trial + past_due) |
| `/onboarding/create-venue` | `{ ok: true, data: { tenant_id: 1004 } }` |
| `/onboarding/toggle-venue` | `{ ok: true }` |
| `/onboarding/update-venue` | `{ ok: true }` |
| `/onboarding/reset-password` | `{ ok: true }` |
| `/onboarding/system-logs` | 2 audit log rows |
| everything else | `route.continue()` (passes through — health/ping hits live API) |

## Pattern 22 — Playwright Route Override: Trailing `**` for Query Strings

**Problem:** `page.route('**/path/to/endpoint', handler)` does NOT match URLs with query strings
(e.g. `?admin_key=...`). The override falls through to a previously registered catch-all handler
and returns the wrong data.

**Rule:** When overriding a specific URL with a query string, always add a trailing `**`:
```javascript
// WRONG — doesn't match /onboarding/system-logs?admin_key=...
await page.route('**/onboarding/system-logs', route => route.fulfill(...));

// CORRECT — ** at end matches optional query params
await page.route('**/onboarding/system-logs**', route => route.fulfill(...));
```

**Also applies to the mock helper itself** — `**/n8n.srv1090894.hstgr.cloud/webhook/**` already
has a trailing `**`, which is why it catches all paths including those with query strings.

## Pattern 26 — N8N_SERVICE_JWT Must Never Be Used for User-Facing Reads

**Problem:** `N8N_SERVICE_JWT` has `tenant_id: 1001` hardcoded in its payload. Any n8n HTTP
Request node that uses it as the `Authorization` header for a db-api call will lock the RLS
context to tenant 1001. Every user — regardless of their actual tenant — receives tenant
1001's data. The symptom is indistinguishable from correct behaviour when only one tenant
exists, making it invisible until a second tenant is provisioned.

**Rule:** `N8N_SERVICE_JWT` is only correct for:
- Scheduled/cron jobs (BillingCycle, PaymentChaser, RecurringGenerator, etc.) — no user session
- Server-to-server internal operations not scoped to a specific user

For **any n8n node that proxies a user's request to db-api**, forward the user's own JWT:

```javascript
// POST webhook — user sent jwt in body
Authorization: ={{ 'Bearer ' + ($('Webhook: Dashboard').first().json.body?.jwt || $env.N8N_SERVICE_JWT) }}

// GET webhook — frontend appended &jwt=<token> to query string
Authorization: ={{ 'Bearer ' + ($json.query?.jwt || $env.N8N_SERVICE_JWT) }}
```

**Frontend side:** GET requests to n8n must append `&jwt=<token>` so the workflow has the
JWT to forward. POST requests already include `jwt` in the body (Pattern 4 / Rule F6).

```javascript
// GET — append jwt to query string
fetch(N8N_URL + tidParam() + '&jwt=' + encodeURIComponent(sessionStorage.getItem('vp_token')||''))

// Reusable: bake jwt into tidUrl() helper so all GET calls get it automatically
function tidUrl(base) {
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + 'tenant_id=' + _TID() + '&jwt=' + encodeURIComponent(sessionStorage.getItem('vp_token')||'');
}
```

**Diagnostic:** If a new tenant sees another tenant's data, search for `N8N_SERVICE_JWT` in
every workflow that serves a user-facing page. Any node using it as the sole auth source for
a read operation is the culprit.

**Workflows confirmed clean (June 25 2026):**
- `hBclMCxbgmz7f3Za_clean.json` — dashboard, customers, bookings, accounts, pending, outstanding, revenue
- `tafp1WtWgLvRY3HC.json` — rooms, event types, pricing, settings
- `nW4p6cg3l7OHwjQP_clean.json` — customer interactions
- `KqSekNRSeXpKh5pJ` (User Manager) — JWT forwarding fixed on all 3 nodes; PEPPER aligned
- `FWkK7gqWxKz4funf` (Recurring Make Booking) — JWT forwarding fixed on 3 nodes
- `Cei912AKyQBPOM9j` (Cancel Booking Series Support) — JWT forwarding fixed on 4 nodes
- `XZMzXBD9ezo9ihXk` (Create Recurring Booking) — already correct, no change needed
- `yuODHy30pR8TR1Kp` (Cancel Recurring Series) — already correct, no change needed
- `hhOxbWh7mW2tbyC5` (Cancellation Manager) — JWT forwarding fixed; broken `Webhook: Cancel Booking` node reference corrected to `Webhook: Cancel`; broken URL expression `{{ }}` → `={{ }}`

**Archived (defunct — no frontend callers):**
- `ZFbEUOuAq5AVy8a5` (Add Recurring Rule) — archived June 25 2026; backup in `_archived_members/`
- `fZMBcIn9LpoE9D9B` (Recurring Walk-In Booking) — archived June 25 2026
- `4ZLKQsWZBgDalvok` (Get Outstanding Payments) — archived June 25 2026; replaced by direct db-api call

**Remaining known uses of service JWT (correct — automated, not user-scoped):**
- `BillingCycleTrigger.json`, `RecurringBookingGenerator.json`, `PendingLifecycleScheduler.json`,
  `RecurringAutoCancel.json`, `RecurringPaymentReminder.json`, `XKKG5SZ75bHg35Zt.json`

**Phase 2 violations remaining: 0** — all user-facing data paths go through db-api with JWT auth and RLS enforcement.

---

## Pattern 25 — onboarding contact_name: Store on tenants, Not staff_users

**Problem:** `POST /onboarding/update-venue` updated `bookings.staff_users.full_name`
to save the contact name. Venues provisioned outside the normal create-venue flow
(or where the staff user was deleted) have no row in `staff_users`. The UPDATE
matched 0 rows, silently succeeded (no error), and the contact name was lost.

**Symptom:** venue name saves correctly; contact name shows success toast but reverts.
The silent UPDATE is indistinguishable from a successful one.

**Fix (migration 027, June 25 2026):**
- `ALTER TABLE bookings.tenants ADD COLUMN IF NOT EXISTS contact_name TEXT`
- `POST /update-venue`: writes `contact_name` into the tenants row directly
  (in addition to staff_users when a staff user exists)
- `GET /venues`: reads `COALESCE(t.contact_name, u.full_name) AS full_name` —
  graceful fallback for existing venues whose staff user carries the name

**Rule:** Admin-panel contact name belongs on `bookings.tenants.contact_name`.
Staff user display names (shown in the dashboard) live on `staff_users.full_name`
and are managed via the staff portal (users.html), not the admin panel.

---

## Pattern 24 — n8n X-Admin-Key: Always Use Server-Side Env Var, Never Frontend Value

**Problem:** n8n write nodes (Toggle Venue, Create Venue, Reset Password, Update Venue) used
this X-Admin-Key header expression:

```javascript
={{ $('Webhook: ...').first().json.body?.admin_key || $env.ONBOARDING_ADMIN_KEY || '' }}
```

The frontend sends `admin_key: 'vp-api-2026-Kj9mXqR4wZ'` (plain text, visible in page source).
The server-side `ONBOARDING_ADMIN_KEY` env var is set to a different value (a hash).
Because the frontend value is non-empty and comes first in the expression, n8n sends the
**wrong key** to db-api. db-api returns `401 INVALID_ADMIN_KEY`. Since `continueOnFail` is
set inside `parameters.options` (not at node level), n8n halts before `Respond: *` fires →
HTTP 200 with **empty body** → `_safeJSON` throws "Empty response from n8n".

`API: List Venues` was unaffected because it uses `$env.ONBOARDING_ADMIN_KEY` exclusively
(no frontend fallback) — this is the correct pattern.

**Rule:** Every n8n HTTP Request node calling a db-api `/onboarding/*` endpoint MUST use:

```javascript
// CORRECT — always uses the server-side key
X-Admin-Key: ={{ $env.ONBOARDING_ADMIN_KEY || '' }}

// WRONG — frontend plain-text key shadows the env var key
X-Admin-Key: ={{ $('Webhook: X').first().json.body?.admin_key || $env.ONBOARDING_ADMIN_KEY || '' }}
```

**Fix applied (June 24 2026):** `API: Toggle Venue`, `API: Create Venue`,
`API: Reset Password`, `API: Update Venue` all patched in `OnboardingManager.json`.
**Re-import required** for the fix to take effect in live n8n.

**Symptom checklist:**
- Write operations (toggle/create/reset/update) fail with "Empty response from n8n"
- Read operations (`GET /onboarding/venues`) work correctly
- This is the tell-tale sign: reads use `$env` directly; writes used the frontend fallback

---

## Pattern 23 — Playwright Strict Mode: Scope Locators to their Modal

**Problem:** A CSS class used on a "close" button (e.g. `.ob-vd-close`) may be reused across
multiple modals on the same page. Playwright's strict mode throws `strict mode violation:
locator resolved to N elements` and the test fails.

**Rule:** Always scope modal-specific locators to their parent element ID:
```javascript
// WRONG — .ob-vd-close matches both venue detail and audit modal buttons
await page.locator('.ob-vd-close').click();

// CORRECT — scoped to the specific modal
await page.locator('#venueDetailModal .ob-vd-close').click();
```

---

# ✉️ Email Trigger System (June 30 2026 Audit)

## Audit Findings — What Was Missing / Broken

| # | Workflow | Bug | Fix |
|---|---|---|---|
| 1 | PendingLifecycleScheduler | `Email: Day 4 Warning` had subject but **no HTML body** — sent blank email | Added `Code: Build Warning Email` node with full styled template |
| 2 | VenuePro - Confirm Booking | **No email sent at all** when staff confirm a pending request | Added `DB: Get Customer For Email` → `Code: Build Confirmation Email` → `Email: Booking Confirmed` |
| 3 | Financial Ops (Stripe Fork) | Stripe confirmation email fired **before verifying payment was recorded** | Added `DB: Verify Stripe Payment` + `IF: Stripe Payment Recorded?` gate; false branch returns HTTP 202 |
| 4 | (missing) | No acknowledgement email to customer on enquiry submit; no staff alert | Created `NewEnquiryNotification.json` (new workflow) + fire-and-forget call in `enquiry-form.html` |

## Live Workflow Map

| Trigger | Workflow | n8n ID | Recipients |
|---------|----------|--------|------------|
| Customer submits enquiry form | VenueDesk - New Enquiry Notification | `Jh6nCEqLVFONT8IB` | Customer (acknowledgement) + Staff (alert with dashboard link) |
| Staff confirm a pending request | VenuePro - Confirm Booking | `MXCss5PTB3YpiQuV` | Customer (booking confirmation with payment summary) |
| Cash/BACS/card payment recorded | VenueDesk - Financial Operations (Stripe + Manual Fork) | `qqmg9R1HRZdsljgt` | Customer (payment receipt — 4 variants: deposit/partial/full/BACS) |
| Stripe payment verified + recorded | VenueDesk - Financial Operations (Stripe + Manual Fork) | `qqmg9R1HRZdsljgt` | Customer (card payment confirmed — only after Stripe webhook records it) |
| Customer pending 4–7 days, no deposit | VenueDesk - Pending Lifecycle (Scheduler) | `B0Nuq8kTqfT4f0Sx` | Customer (expiry warning — runs daily at 08:00) |

## Email Content Summary

| Email | Header colour | Key content |
|-------|--------------|-------------|
| Enquiry received (customer) | Indigo | Space, date, time, guests, 7-day window warning, contact CTA |
| New enquiry (staff alert) | Dark slate | Customer name/email/phone, event details, ref ID, dashboard deep link |
| Booking confirmed | Green | Date, time, space, event type, guests, total/deposit/balance, balance-due callout if applicable |
| Deposit confirmed | Indigo | Amount paid, room, date/time, reference number, balance remaining |
| Partial payment | Amber | Amount paid, remaining balance, reference number |
| Balance fully settled | Green | Final payment amount, "Fully Paid ✓", reference number |
| BACS awaiting payment | Amber | Sort code, account number, account name, booking ID as payment ref |
| Stripe card confirmed | Green | Card payment amount, reference, room, date/time |
| Expiry warning | Amber | Countdown days remaining, submitted-on date, consequences of inaction, mailto CTA |

## SMTP Credential
All email nodes use **Hostinger SMTP** (n8n credential ID: `J0qWHzypu4SvoXyg`).
`fromEmail` on all transactional emails: `bookings@venuedesk.co.uk`.

## Stripe Email Safety Gate (Pattern 28)

**Problem:** The Stripe path in the Financial Operations workflow previously built and sent a
confirmation email immediately when `payment_method === 'stripe'` was received — before
verifying that the Stripe webhook had actually recorded the payment in the database. A caller
could trigger the confirmation email on an unpaid booking.

**Fix:** Before `Code: Build Stripe Email`, the workflow now calls `GET /bookings/{booking_id}`
and checks if `balance_due` has decreased (proof the Stripe webhook fired). If not, it returns
HTTP 202 `STRIPE_PAYMENT_PENDING` without sending an email.

```
IF: Is Stripe? (true)
  → DB: Verify Stripe Payment  (GET /bookings/{id})
  → IF: Stripe Payment Recorded?
      true  → Code: Build Stripe Email → Respond: Success → Email: Stripe Confirmation
      false → Respond: Payment Not Yet Recorded (HTTP 202)
```

## Pattern 29 — Never Pin a SplitInBatches Node in test_workflow

**Problem:** Pinning a `splitInBatches` node directly in `test_workflow` strips its internal
queue state. On every loop-back from the downstream chain (`Email → Mark Warning Sent → Split`),
the pinned node returns the same item again instead of terminating. This creates an infinite
loop, sending real emails on every iteration until n8n's execution limit is reached.

**Symptom:** 100+ duplicate emails sent during testing.

**Rule:** Never add a `splitInBatches` node to `pinData` in `test_workflow`. Instead:
- Pin only the HTTP Request nodes that feed INTO the loop
- Let the SplitInBatches node run normally — it will process the pinned data correctly
- If you need to test just the Code/Email logic inside the loop, pin the HTTP nodes that
  the Code nodes read from (e.g. `HTTP: Get Pending Warnings`) but leave `Split: Warning Batch`
  unpinned

**Also note:** `test_workflow` does NOT automatically pin credential-based nodes (emailSend).
Real emails will be sent. If testing against a real inbox, use a test email address or
ensure SMTP rate limits won't be hit by rapid consecutive test runs.

## Enquiry Form → Notification Webhook

Both submission paths in `enquiry-form.html` now fire a fire-and-forget POST to
`https://n8n.srv1090894.hstgr.cloud/webhook/enquiry-received-email` after a successful
`POST /enquiry/create-request`. The payload includes all enquiry fields plus `booking_request_id`
from the db-api response.

```javascript
// Both submitEnquiry() (free) and submitWithDeposit() (Stripe) paths:
fetch('https://n8n.srv1090894.hstgr.cloud/webhook/enquiry-received-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, booking_request_id: j.booking_request_id || null })
}).catch(() => {});  // fire-and-forget — never blocks the user flow
```

The n8n workflow (`Jh6nCEqLVFONT8IB`) sends both emails in parallel with the `Respond: OK`
node, so the response to the frontend is never delayed by email sending.

---

## Staff Notification Email — Per-Venue Configuration (June 30 2026)

The address that receives the new-enquiry staff alert is now configurable per-venue.
Previously hardcoded to `bookings@venuedesk.co.uk`.

**Setting:** `bookings.settings` key `staff_notification_email`

**Configured via:** Admin Config → Settings → "Staff Notification Email" card
- Client-side email format validation before saving
- Saved via `POST /update-setting` n8n webhook → `POST /config/settings/upsert`
- `loadSettings()` populates the field on tab open and shows current value in status line

**`GET /stripe/config` extended:**
Now returns `staff_notification_email` alongside `is_stripe_enabled` and
`stripe_publishable_key`. Source: `SELECT value FROM bookings.settings WHERE key = 'staff_notification_email' LIMIT 1` inside the `withTenantContext` call. Public endpoint; no auth required.

**n8n workflow node added (`Jh6nCEqLVFONT8IB`):**
`HTTP: Get Tenant Config` (GET `/stripe/config?tenant_id=…`) fires before
`Code: Staff Notification`. Resolution order in the Code node:
```javascript
const staffEmail = cfg.staff_notification_email || 'bookings@venuedesk.co.uk';
```
The setting is read fresh on every enquiry — changing it in Admin Config takes effect
immediately on the next submission, no restart or re-import required.
