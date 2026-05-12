# VenueDesk API v2 — Installation Guide

> **Replaces:** n8n self-hosted instance  
> **Runtime:** Node.js ≥ 20  
> **Database:** Existing PostgreSQL (`bookings` schema — no destructive changes)

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.x | [nodejs.org](https://nodejs.org) |
| npm | ≥ 10.x | Bundled with Node 20 |
| PostgreSQL | ≥ 14 | Existing VenueDesk DB — no migration required |
| SMTP server | — | Any provider (Postmark, SendGrid, or self-hosted) |
| OpenAI API key | — | `gpt-4o-mini` access required |
| Google Places API key | — | Text Search API enabled |

---

## 1. Clone / Copy the Project

If you are working from the `venue_desk_backup` folder, the API lives at:

```
venue_desk_backup/venuedesk-api/
```

Copy it to your server or deployment target:

```bash
cp -r venue_desk_backup/venuedesk-api /opt/venuedesk-api
cd /opt/venuedesk-api
```

---

## 2. Install Dependencies

```bash
npm install
```

This installs: `fastify`, `pg`, `node-cron`, `openai`, `nodemailer`, `bcrypt`, `axios`, `dotenv`, and supporting packages.

---

## 3. Configure Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
nano .env   # or use your preferred editor
```

### Required variables

```dotenv
# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@host:5432/venuedesk

# JWT signing secret — generate with: openssl rand -hex 64
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRY=60m

# HTTP server port
PORT=3000

# SMTP credentials
SMTP_HOST=smtp.yourvenue.co.uk
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=bookings@yourvenue.co.uk
SMTP_PASS=your-smtp-password
EMAIL_FROM=bookings@yourvenue.co.uk
EMAIL_FROM_NAME=VenueDesk

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Google Places
GOOGLE_PLACES_API_KEY=your-google-api-key

# Default tenant (single-tenant)
DEFAULT_TENANT_ID=1001

# Must match the pepper used in existing password hashes
PASSWORD_PEPPER=vp-pepper-change-me
```

> **Security note:** Never commit `.env` to version control. Add it to `.gitignore`.

---

## 4. Verify Database Connectivity

The API runs idempotent migrations on every boot — no manual SQL required. To confirm your `DATABASE_URL` is correct before starting:

```bash
node -e "
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query('SELECT current_database(), current_user')
  .then(r => { console.log('Connected:', r.rows[0]); p.end(); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); });
" DATABASE_URL="postgresql://user:pass@host/db"
```

---

## 5. Start the Server

### Development (auto-restart on file changes)

```bash
npm run dev
```

### Production

```bash
npm start
```

Expected output on a clean boot:

```
[INFO][migrate] startup migrations applied
[INFO] Server listening at http://0.0.0.0:3000
[INFO][SchedulerService] 3 cron jobs registered { jobs: ['lead-discovery','billing-cycle','ai-analysis'] }
```

### Health check

```bash
curl http://localhost:3000/health
# → {"status":"ok","version":"2.0.0","ts":"2026-04-16T..."}
```

---

## 6. Production Deployment with PM2

PM2 keeps the process alive, restarts on crash, and survives server reboots.

```bash
# Install PM2 globally
npm install -g pm2

# Start the API
pm2 start src/server.js --name venuedesk-api

# Save the process list so it survives reboots
pm2 save
pm2 startup   # follow the printed command to register as a system service
```

Useful PM2 commands:

```bash
pm2 logs venuedesk-api        # tail logs
pm2 restart venuedesk-api     # restart after a config change
pm2 stop venuedesk-api        # stop without removing
pm2 status                    # overview of all processes
```

---

## 7. Cron Job Schedule

All scheduled jobs run automatically once the server starts. No external scheduler is needed.

| Job | Cron | Timezone | Description |
|---|---|---|---|
| `lead-discovery` | `0 6 * * *` | Europe/London | Google Places scrape, county rotates daily |
| `billing-cycle` | `0 8 * * *` | Europe/London | Creates outstanding payments, sends reminders |
| `ai-analysis` | `0 9 * * *` | Europe/London | Scores new leads via OpenAI, sends follow-ups |

### Manually triggering a job

Use the admin endpoint to run any job immediately without waiting for the scheduled time. Requires an admin JWT.

```bash
curl -X POST http://localhost:3000/admin/run-job \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"job": "lead-discovery"}'

# Response (202 Accepted — job runs in background)
# {"success":true,"queued":true,"job":"lead-discovery"}
```

Valid job names: `lead-discovery`, `billing-cycle`, `ai-analysis`.

---

## 8. Viewing System Logs

All cron job activity, email sends, and errors are written to `bookings.system_logs`. This replaces the n8n Executions tab.

### Via the API

```bash
# All recent logs
curl http://localhost:3000/admin/logs \
  -H "Authorization: Bearer <admin-jwt>"

# Errors only
curl "http://localhost:3000/admin/logs?level=error&limit=50" \
  -H "Authorization: Bearer <admin-jwt>"
```

### Via SQL (psql / any DB client)

```sql
-- Last 50 entries
SELECT created_at, level, source, message, detail
FROM   bookings.system_logs
ORDER  BY created_at DESC
LIMIT  50;

-- Errors from today
SELECT *
FROM   bookings.system_logs
WHERE  level = 'error'
  AND  created_at >= CURRENT_DATE
ORDER  BY created_at DESC;

-- All activity for a specific tenant
SELECT *
FROM   bookings.system_logs
WHERE  tenant_id = 1001
ORDER  BY created_at DESC;
```

---

## 9. Environment Validation Checklist

Run through this before going live:

```
[ ] DATABASE_URL connects and the bookings schema is accessible
[ ] JWT_SECRET is at least 64 characters and not the default placeholder
[ ] SMTP credentials verified — send a test email via your provider's portal
[ ] OPENAI_API_KEY has sufficient credits and gpt-4o-mini access
[ ] GOOGLE_PLACES_API_KEY has the Places API (New) Text Search endpoint enabled
[ ] PORT is not blocked by a firewall
[ ] PASSWORD_PEPPER matches the value used to hash existing staff passwords
[ ] .env is not committed to git (.gitignore confirmed)
[ ] PM2 startup script registered (server survives reboot)
```

---

## 10. Upgrading from n8n

Once the API is running and all cron jobs have completed at least one successful cycle:

1. Verify `bookings.system_logs` contains entries for all three jobs.
2. Verify the `prospects` table is being populated correctly.
3. Deactivate the following n8n workflows (do not delete until stable for 1 week):
   - `VenueDesk — Lead Discovery (Daily)`
   - `VenueDesk — AI Lead Generator (Daily)`
   - `VenueDesk — Billing Cycle Daily Trigger`
   - `VenueDesk — API: Update Lead Status`

> Webhook-based workflows (`make-booking`, `confirm-booking`, etc.) are **not** yet ported and should remain active in n8n until Phase 2 of the migration is complete.

---

## Troubleshooting

**Server exits immediately on start**  
Check `DATABASE_URL` — the pool will fail silently but migrations throw on connection errors. Run the connectivity test in Step 4.

**Cron jobs not firing**  
Confirm the server timezone resolves correctly: `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"`. Jobs use `Europe/London` — if your server is UTC, 06:00 London time = 06:00 UTC (winter) or 05:00 UTC (summer).

**`SMTP connection refused` in logs**  
Verify `SMTP_PORT` and `SMTP_SECURE`. Port 587 uses STARTTLS (`SMTP_SECURE=false`). Port 465 uses implicit TLS (`SMTP_SECURE=true`).

**`rate_limit_exceeded` from OpenAI**  
The AI analysis job processes up to 20 leads per run. If you have a large backlog, temporarily set the `LIMIT` in `LeadDiscoveryService._scoreNewLeads()` to a lower number (e.g., `LIMIT 5`) and let it catch up over several days.

**`relation "bookings.system_logs" does not exist`**  
The migrations in `src/db/migrate.js` create this table on boot. If it failed, check that the DB user in `DATABASE_URL` has `CREATE TABLE` privileges on the `bookings` schema.
