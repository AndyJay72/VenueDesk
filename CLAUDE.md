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

