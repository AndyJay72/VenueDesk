# Feature C — Per-Cycle Payment Cadence (Design Doc, v2)

**Status**: APPROVED — all §9 open questions resolved (2026-05-23). Ready for §10 implementation order.
**Author**: Andrew + Claude
**Date**: 2026-05-23
**Predecessor**: Bulk "Pay In Full" Stripe flow (shipped 2026-05-22, fixed Pattern 3 violation 2026-05-23)
**Related tasks**: #114 (this design), #112 (Pattern 3 fix — DONE), #113 (backfill stuck series — DONE), #115 (Master Log reconciliation — this revision), #116 (recurring.js diagnosis correction)

**v2 changes from v1**:
- Renamed `payment_cadence` → `payment_timing` to match Master System Log §3 canonical naming
- Revised `in_arrears` flow: now uses Stripe £0 SetupIntent card-capture + saved card on customer profile (off-session charges per cycle), replacing v1's "no Stripe interaction" model
- Added Stripe Customer + PaymentMethod persistence requirements to schema (§3.5)

---

## 1. Problem Statement

The current "Create Series (Full Cycle Payment)" button presents only a single Stripe Checkout for the **entire series total**. For a 48-session weekly series at £30/session, that is a £1,440 upfront ask — unrealistic for most customers booking long-running classes, rehearsals, or recurring meetings.

The user requirement (verbatim):

> "there needs to be an option to pay per cycle in advance or arrears and the option to pay in full"

Three customer-facing payment modes must be supported (Master Log §3 canonical naming — `payment_timing` field):

| `payment_timing` | Customer pays | Stripe action | Sessions confirmed |
|------------------|---------------|---------------|--------------------|
| `in_full` | All sessions, upfront, one Stripe txn | Aggregate Checkout for full series total | All confirmed on payment webhook |
| `in_advance` | One cycle at a time, before each cycle starts | Cycle 1 Checkout now; cycles 2..N billed via saved card 7 days before cycle_start | Only the paid cycle's sessions confirmed |
| `in_arrears` | One cycle at a time, after each cycle ends | **£0 SetupIntent at checkout** for card validation + token capture; saved to customer profile; charged 7 days after each cycle_end | All sessions confirmed upfront (trust model + on-file card) |

---

## 2. Definitions

**Cycle**: A contiguous block of `N` sessions billed as a single Stripe transaction.
Default cycle length is **4 weeks** (= 4 sessions for a weekly series; 2 for biweekly; 1 for monthly). Configurable per series via `recurring_series.cycle_length_weeks`.

**Series total**: `rate × sessions_count` — what `in_full` charges.
**Cycle amount**: `rate × sessions_in_cycle` — what `in_advance` / `in_arrears` charges per Stripe transaction. The **final cycle** may be smaller if `sessions_count` doesn't divide evenly.

**Schedule row**: A planned future payment, materialised in `bookings.recurring_payment_schedule` at series creation time. Cron sweeps this table to generate Stripe sessions on `due_date`.

---

## 3. Database Schema Changes

### 3.1 `recurring_series` — additive

```sql
ALTER TABLE bookings.recurring_series
  ADD COLUMN payment_timing     TEXT NOT NULL DEFAULT 'in_full'
    CHECK (payment_timing IN ('in_full', 'in_advance', 'in_arrears')),
  ADD COLUMN cycle_length_weeks INT  NULL
    CHECK (cycle_length_weeks IS NULL OR cycle_length_weeks BETWEEN 1 AND 52);
```

Existing rows default to `in_full`, `cycle_length_weeks = NULL` — non-breaking.

### 3.2 `bookings.recurring_payment_schedule` — EXTEND existing Phase 3 table

**Reality check (2026-05-23 diagnostic):** Phase 3 already shipped this table with rich columns and RLS enforced. Feature C must EXTEND it, not recreate it. Canonical column names below are the existing Phase 3 names — the design doc previously invented alternates (`cycle_start_date`, `amount`) that don't exist.

**Existing columns (Phase 3, do not rename):**
- `id UUID PK`, `tenant_id INT NOT NULL`
- `recurring_series_id UUID` (FK to series, our anchor for Feature C — also `recurring_rule_id UUID` FK to legacy rules table)
- `customer_id UUID NOT NULL` (FK to customers)
- `cycle_number INT`
- `period_start DATE NOT NULL`, `period_end DATE NOT NULL` *(Feature C "cycle dates")*
- `amount_due NUMERIC(10,2) NOT NULL` *(Feature C "cycle amount")*
- `due_date DATE NOT NULL`
- `status TEXT NOT NULL DEFAULT 'pending'`
- `paid_at TIMESTAMPTZ`, `created_at`, `updated_at`
- `series_reference VARCHAR(255)`, `migration_source TEXT`, `billing_day INT`, `upfront_paid BOOLEAN`, `total_cycles INT`, `remaining_cycles INT`, `payment_timing VARCHAR(20)`, `reminder_sent_at TIMESTAMPTZ`, `override_by TEXT`, `override_note TEXT`
- RLS forced ✓, policy `tenant_isolation_policy` ✓
- UNIQUE `(recurring_series_id, cycle_number) WHERE both NOT NULL` ✓

**Migration 020 ADDS (only):**
```sql
ALTER TABLE bookings.recurring_payment_schedule
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,        -- cs_... (Checkout) or pi_... (off-session)
  ADD COLUMN IF NOT EXISTS attempt_count     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rps_due_status_tenant
  ON bookings.recurring_payment_schedule(due_date, status, tenant_id);
```

**Status enum (EXTENDED via DROP + ADD CHECK):**

Existing: `('pending','paid','overridden','cancelled','overdue')`
**New union**: `('pending','sent','paid','failed','overridden','cancelled','overdue')`

State mapping:
- `pending` = cron hasn't attempted yet (initial state for all newly-inserted cycles)
- `sent` *(new)* = Stripe session/PaymentIntent created, awaiting customer / off-session confirmation
- `paid` = customer/off-session charge completed
- `failed` *(new)* = card declined or PaymentIntent failed
- `overdue` = past `due_date` with status still `pending` or `failed` (escalation state)
- `overridden` = staff manual override (existing, preserved)
- `cancelled` = series cancelled before this cycle billed

### 3.3 `confirmed_bookings` — add cycle pointer (DRY: avoid joining through schedule for every session lookup)

```sql
ALTER TABLE bookings.confirmed_bookings
  ADD COLUMN payment_schedule_id UUID NULL
    REFERENCES bookings.recurring_payment_schedule(id) ON DELETE SET NULL;

CREATE INDEX idx_cb_payment_schedule ON bookings.confirmed_bookings(payment_schedule_id);
```

Every recurring session is tagged with the cycle it belongs to. Used by the webhook to confirm exactly that cycle's sessions on payment, and by `accounts.html` to render "Cycle 2 of 6 — paid 12 Jun" badges.

### 3.4 `payments` — already has `recurring_series_id`; no change

The `payments` row created per cycle uses:
- `recurring_series_id` = parent series
- `booking_id` = first session of the cycle (for join stability — same pattern as `in_full`)
- `payment_type = 'cycle'` (new value; or reuse `'full'` and disambiguate via amount — see §9)
- `reference_number` = Stripe `cs_test_...` / `cs_live_...` for Checkout flows, or `pi_...` for off-session PaymentIntent charges (in_advance cycles 2..N and all in_arrears cycles)

### 3.5 `customers` — Stripe persistence (NEW per v2 / Master Log in_arrears spec)

```sql
ALTER TABLE bookings.customers
  ADD COLUMN stripe_customer_id        TEXT NULL,    -- cus_...  (set on first SetupIntent or Checkout completion)
  ADD COLUMN default_payment_method_id TEXT NULL;    -- pm_...   (set when card_on_file captured)

CREATE INDEX idx_customers_stripe_customer
  ON bookings.customers(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
```

Why both columns: `stripe_customer_id` is the durable Stripe Customer resource we attach all future PaymentMethods to. `default_payment_method_id` is the most-recently-captured card token used for off-session charges. When a customer updates their card mid-series, only `default_payment_method_id` rotates — Stripe Customer survives.

The cron-driven cycle billing for `in_advance` (cycles 2..N) and `in_arrears` (all cycles) uses Stripe's off-session PaymentIntent API:
```js
await stripe.paymentIntents.create({
  customer: customer.stripe_customer_id,
  payment_method: customer.default_payment_method_id,
  amount: cycleAmount * 100,
  currency: 'gbp',
  confirm: true,
  off_session: true,
  metadata: { cycle_id, recurring_series_id, tenant_id }
});
```

3DS challenges that come back as `requires_action` are caught in the webhook, schedule row flips to `failed`, customer emailed a re-auth link. Standard Stripe off-session pattern.

---

## 4. Stripe Architecture Decision

### Option A: Stripe Subscriptions
- Pro: native recurring billing, automatic retries, customer portal
- Con: assumes regular calendar cadence; struggles with our model where sessions/cycle varies, dates skip clashes, and cycles aren't pure month/week boundaries
- Con: proration, mid-series cancellation, and pause flows are heavy
- Con: introduces a new Stripe primitive (Customer + Subscription + Price + Product) on top of our existing one-off Checkout flow

### Option B (RECOMMENDED): One-off Checkout per cycle, driven by cron
- Pro: reuses the exact `/stripe/session` + webhook plumbing we already have
- Pro: each cycle amount is computed from `recurring_payment_schedule.amount` — no Stripe Price catalog to maintain
- Pro: cron-driven matches our existing `scheduled-tasks` infrastructure
- Pro: failure handling, retries, and cancellation are all SQL state machines we control
- Con: we lose Stripe-native dunning emails (need to send our own)
- Con: cron lag means a missed cron run delays payment requests

**Decision**: Option B. The DRY win (one Stripe code path, one webhook switch) outweighs Stripe Subscriptions' built-in dunning.

---

## 5. End-to-End Flows

### 5.1 `in_full` (existing — unchanged)
1. Frontend POST `/recurring/create` with `payment_timing='in_full'`, `payment_method='card'`
2. db-api: insert series + sessions (`status='pending'`), insert no schedule rows
3. db-api returns `stripe_url` (Stripe Checkout mode=`payment`)
4. Customer pays; webhook (`checkout.session.completed`) flips all sessions to `confirmed`, zeroes `balance_due`, inserts one `payments` row, and persists `stripe_customer_id` + `default_payment_method_id` to `customers` (free upgrade — future cycles for a re-booked series will already have a card on file)

### 5.2 `in_advance`
1. Frontend POST `/recurring/create` with `payment_timing='in_advance'`, `cycle_length_weeks=4`, `payment_method='card'`
2. db-api computes cycle boundaries from the materialised session list (e.g. 48 weekly sessions → 12 cycles of 4)
3. db-api inserts:
   - 48 sessions (all `status='pending'`, each tagged with `payment_schedule_id`)
   - 12 `recurring_payment_schedule` rows: cycle 1 `due_date = today`, cycles 2..12 `due_date = cycle_start - 7d`, all `status='scheduled'`
4. db-api **immediately** creates Stripe Checkout for cycle 1 (mode=`payment` + `payment_intent_data.setup_future_usage='off_session'` so the card is auto-saved on payment success)
5. Returns `stripe_url` for cycle 1
6. Customer pays cycle 1; webhook:
   - Flips cycle 1's 4 sessions to `confirmed`
   - Sets schedule row `status='paid'`, `paid_at=NOW()`
   - Inserts `payments` row pinned to cycle 1's first session
   - Persists `stripe_customer_id` + `default_payment_method_id` to `customers`
   - Recomputes `recurring_series.balance_due = SUM(unpaid cycles)`
7. Cron (daily 06:00 UTC): for each `scheduled` row with `due_date <= today`:
   - Look up `customer.default_payment_method_id`
   - Create off-session PaymentIntent (`confirm: true, off_session: true`)
   - Set `status='sent'`, `attempt_count++`, `stripe_session_id = pi_...` (PaymentIntent id, not Checkout session id — column rename or comment-only?)
8. Webhook on `payment_intent.succeeded`: same DB updates as step 6

### 5.3 `in_arrears` (REVISED v2 — Master Log §3 spec)
1. Frontend POST `/recurring/create` with `payment_timing='in_arrears'`, `cycle_length_weeks=4`, `payment_method='card'`
2. db-api inserts:
   - 48 sessions, **all `status='confirmed'`** (trust model — customer billed after use)
   - 12 schedule rows, `due_date = cycle_end + 7d`, all `status='scheduled'`
3. db-api creates **Stripe Checkout in `mode='setup'`** — £0 SetupIntent that validates the card and captures `payment_method` without charging
4. Returns `stripe_url` for the SetupIntent flow
5. Customer completes the SetupIntent; webhook (`checkout.session.completed` with `mode=setup`):
   - Persists `stripe_customer_id` + `default_payment_method_id` to `customers`
   - Marks `recurring_series.card_on_file_at = NOW()` (new nullable timestamp column on series)
   - Does NOT insert any `payments` row (no money moved)
   - Sends confirmation email: "Card on file — first bill £120 due {cycle_1_end + 7d}"
6. Cron + webhook same as `in_advance` from step 7 onward

**Failure mode for §5.3 step 5**: if customer abandons the SetupIntent flow, sessions are already `confirmed` but no card is on file. After 48 hours, n8n scheduled task flips all sessions back to `pending` and emails staff to manually follow up. This is the only path where session status can regress, so it gets a dedicated `system_logs` entry tagged `card_on_file_abandoned`.

---

## 6. Failure Handling

### 6.1 Card declined / abandoned Checkout
- Webhook receives `checkout.session.expired` or never receives `checkout.session.completed`
- Cron re-sweeps schedule rows where `status='sent' AND due_date < today - 3d` → flip to `failed`, increment `attempt_count`, send reminder email
- After `attempt_count >= 3`: flip to `overdue`, alert staff via `system_logs` + email staff inbox
- `in_advance`: cycle's sessions remain `pending` until paid; do NOT auto-cancel (staff decides)
- `in_arrears`: cycle's sessions already happened (`confirmed`); becomes an AR collections problem (staff intervenes)

### 6.2 Customer cancels the series mid-way
- New endpoint `POST /recurring/cancel` with `cancel_from_cycle` (int)
- For all schedule rows `cycle_number >= cancel_from_cycle AND status IN ('scheduled','sent')`: set `status='cancelled'`
- For all sessions in those cycles: set `status='cancelled'`
- `in_arrears` already-completed unpaid cycles: leave as `status='sent'` / `'overdue'` — money still owed
- Refunds: out of scope for v1 (manual via Stripe dashboard, log in `system_logs`)

### 6.3 Dispute / chargeback
- Out of scope for v1 — Stripe webhook `charge.dispute.created` lands in `system_logs` for staff manual review only

---

## 7. API Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/recurring/create` | POST | Extend existing — accept `payment_cadence`, `cycle_length_weeks`; branch on cadence |
| `/recurring/:id/schedule` | GET | List cycles + payment status (for `accounts.html` drill-down) |
| `/recurring/cancel` | POST | Cancel series from cycle N onward |
| `/stripe/cycle-session` | POST | Cron-internal: create Checkout for one schedule row (uses `Authorization: Bearer` — server-to-server, Pattern 4 scope rule) |
| `/stripe/webhook` | POST | Extend existing webhook — third branch for `cycle_id` in metadata |

### `/recurring/create` request shape (extended)

```jsonc
{
  "jwt": "...",
  "tenant_id": 1001,
  "customer_id": "uuid",
  "room_id": "uuid",
  "series_name": "Yoga Mondays",
  "rate": 30.00,
  "sessions": [{ "date": "2026-06-01", "start_time": "18:00", "end_time": "19:00" }, ...],
  "payment_method": "card",
  "payment_timing": "in_advance",         // NEW: 'in_full' | 'in_advance' | 'in_arrears'
  "cycle_length_weeks": 4                 // NEW: required when timing != 'in_full'
}
```

### Response shape (timing-dependent)

```jsonc
// in_full + card: same as today (Checkout mode=payment, full series total)
{ "series_id": "uuid", "stripe_url": "https://checkout.stripe.com/...", "stripe_mode": "payment" }

// in_advance + card: Checkout mode=payment for cycle 1 (+ setup_future_usage)
{ "series_id": "uuid", "stripe_url": "...", "stripe_mode": "payment", "schedule": [...12 rows...] }

// in_arrears + card: Checkout mode=setup for £0 card validation
{ "series_id": "uuid", "stripe_url": "...", "stripe_mode": "setup", "schedule": [...12 rows...] }
```

All three timings now return a `stripe_url` — the frontend redirects regardless. Only the Stripe Checkout `mode` differs (`payment` vs `setup`), which is invisible to the customer at the Stripe UI level (they see card fields either way; `setup` mode just says "Save card" instead of "Pay £X").

---

## 8. Frontend Changes (`calendar.html` qb-card modal)

Replace the single "Create Series (Full Cycle Payment)" button with a three-option radio group:

```
○ Pay In Full
  £1,440.00 — single payment now

○ Pay Per Cycle (In Advance)        ← RECOMMENDED
  £120.00 every 4 weeks
  First payment now, then 11 more cycles
  Each cycle confirms only that cycle's sessions

○ Pay Per Cycle (In Arrears)
  £120.00 every 4 weeks
  £0 card validation now — billed after each cycle ends
  All sessions confirmed upfront

[Cycle length: (4 weeks ▾)]   ← only shown when In Advance / In Arrears selected
```

JS extension to `qbDoSubmitRecurring`:
- Read radio selection → `payment_timing`
- Read `cycle_length_weeks` (default 4)
- Post to `/recurring/create`
- All three timings return `stripe_url` → redirect (single code path, DRY win)
- Post-checkout, `checkout.html` reads `?series_id=...&timing=...` and shows timing-specific success copy ("Cycle 1 paid — next bill {date}" / "Card on file — first bill {date}" / "All sessions paid in full")

UI per Rule F2 — vanilla JS, dark-theme tokens, no framework.

---

## 9. Decisions Locked (2026-05-23)

All seven open questions resolved per Andrew's review — proceeding with recommended approach in every case.

1. **`payment_type` enum**: ADD `'cycle'` value. `'full'` reserved for whole-series settlement. Enables `SELECT payment_type, COUNT(*) FROM payments GROUP BY payment_type` reporting without amount-disambiguation gymnastics.

2. **Cycle length unit**: WEEKS. UI surfaces a `<select>` of {1, 2, 4, 8, 12, 26, 52}. Sessions-per-cycle derived from `recurring_series.frequency` × `cycle_length_weeks`. v2 may add a "bill every N sessions" toggle if staff demand surfaces.

3. **Final cycle handling**: ACCEPT smaller final cycle. 50 weekly sessions @ cycle=4w → 12×4 + 1×2 = final cycle bills £60 instead of £120. Refund alternative is worse UX and creates Stripe refund noise.

4. **Cron cadence**: DAILY at 06:00 UTC. `due_date` is `DATE` not `TIMESTAMPTZ` — intra-day precision adds no value. Single n8n Schedule node, single sweep, deterministic.

5. **Email delivery**: n8n workflow `VenueDesk - Send Cycle Payment Link`, triggered by db-api webhook after cron flips `status='sent'`. Note: with off-session PaymentIntent charging (v2 change), email frequency drops significantly — only `requires_action` (3DS) and `payment_failed` paths now need customer email. Successful off-session charges only email a receipt.

6. **`in_arrears` trust threshold**: v1 — NO LIMITS. Staff judgement at series creation. v2 task created (#117) to add `customers.credit_status` enum + admin UI gate. Tracked for post-launch.

7. **Schedule row visibility**: INLINE COLLAPSIBLE under the series row on `accounts.html` customer drill-down. Render as a sub-table with columns: `Cycle | Dates | Sessions | Amount | Due | Status | Stripe Ref`. Click-to-expand keeps related data co-located.

---

## 10. Implementation Order (Recommended)

1. **Migration** — `006_recurring_payment_schedule.sql` (additive, idempotent, RLS enforced)
2. **db-api `/recurring/create` extension** — branch on `payment_cadence`; insert schedule rows; return cycle-1 Stripe URL for `in_advance`
3. **db-api `/stripe/webhook` extension** — third branch for `cycle_id` in metadata; mirror the bulk-series UPDATE/INSERT pattern but scoped to one cycle's sessions
4. **db-api `/stripe/cycle-session` endpoint** — internal use by cron
5. **n8n workflow `VenueDesk - Cron Cycle Payment Sweep`** — daily 06:00 UTC, calls `/recurring/cycles/due`, loops over results, POSTs to `/stripe/cycle-session`, sends customer email
6. **n8n workflow `VenueDesk - Send Cycle Payment Link`** — email template + Mailgun/SMTP
7. **Frontend `calendar.html`** — three-radio UI, JS branch for in_arrears (no Stripe redirect)
8. **Frontend `accounts.html`** — schedule drill-down rendering
9. **Smoke tests** — one series per cadence, end-to-end, verify schedule + sessions + payments + system_logs all align

Estimated effort: **2–3 focused sessions** assuming no schema surprises. Migration + db-api work is one session; cron + n8n is one session; frontend is one session.

---

## 11. Invariants (Architectural)

Same canonical rules from the bulk-series rollout, extended:

1. **`bookings.payments` rows for card payments are created EXCLUSIVELY by `stripe.js` webhook.** No write paths in `bookings.js` or `recurring.js` for card. Cash/BACS/bank_transfer record immediately.
2. **Cycle ↔ sessions mapping is materialised, not derived.** `confirmed_bookings.payment_schedule_id` is the FK truth; do not recompute cycles on the fly.
3. **`recurring_series.balance_due` = `SUM(amount) WHERE status NOT IN ('paid','cancelled')` from schedule rows** for timed series. For `in_full` series it remains the old SUM-from-payments behaviour. Compute via one trigger or one helper — pick one, document it.
4. **Pattern 3**: every parameterised query touching schedule rows uses explicit casts (`$1::uuid`, `$2::int`, `$3::numeric`) — no exceptions, especially in the webhook where this bit us last time.
5. **Pattern 4 / Rule F6**: frontend → db-api uses body-tunnel JWT; cron → db-api uses Authorization header. Don't homogenise.
6. **Stripe Customer is the persistence root.** `bookings.customers.stripe_customer_id` survives PaymentMethod rotation. `default_payment_method_id` rotates on every card update but never deleted (audit/refund traceability).
7. **Skip-on-clash logic lives at the edge, not in db-api.** `recurring.js /insert-bookings` consumes a pre-filtered `dates_csv` (see route comment line 473). The filter is applied in `calendar.html` line 2101 (Set-based `clashedSet.has()` exclusion) and in n8n `CreateRecurringFromCalendar` → `Code: Filter Dates` node. Do NOT add clash detection inside the db-api insert loop — that would create two competing sources of truth. (Correcting Master Log §2.1 misdiagnosis.)

---

## 12. Out of Scope (v1)

- Stripe Subscriptions migration
- Automated partial refunds on series cancellation
- Customer self-service cycle reschedule (e.g. "move my Tuesday slot")
- Multi-currency cycles
- Dispute/chargeback automation
- "Pay every N sessions" alongside "pay every N weeks"
