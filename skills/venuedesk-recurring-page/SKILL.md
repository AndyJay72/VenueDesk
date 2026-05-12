---
name: venuedesk-recurring-page
description: >
  Build, extend, and maintain the VenueDesk recurring-bookings.html page — a
  dedicated booking interface for recurring sessions. Use this skill whenever
  the user asks to: add fields or change layout on recurring-bookings.html,
  modify the mini-calendar date pickers, change drag-selection behaviour,
  adjust the auto-schedule or specific-dates modes, fix display or CSS issues
  on the recurring bookings page, wire up new n8n webhook endpoints to the
  recurring booking form, or build a new VenueDesk frontend page that uses
  FullCalendar, mini monthly calendars, or a booking panel. Also use when
  the user says things like "the recurring calendar", "the repeat bookings
  page", "the mini cals", or "fix the date picker on recurring bookings".
---

# VenueDesk — Recurring Bookings Page Skill

## What this page does

`recurring-bookings.html` is a standalone page in `venue_desk_backup/CommunityHub/`.
It lets staff create recurring booking series. It has three main areas:

1. **Main FullCalendar** — read-only view of all existing bookings for reference;
   clicking a date adds it to the selection.
2. **Mini monthly calendars** — 3 months shown side-by-side below the main
   calendar; staff drag down columns to select recurring weekdays.
3. **Booking form panel** (right side) — customer info, room, times, rate,
   scheduling mode (auto or specific dates), preview, submit.

---

## Guiding principles for this page

- Always read the current file before editing — it has changed through several
  iterations and the code here may differ from earlier patterns.
- The page shares auth, tenant, and API patterns with every other VenueDesk
  page. Never invent new patterns; follow the conventions in the reference
  section below.
- JS must pass a syntax check (`node --input-type=module` trick, see below)
  after every edit. Don't leave orphaned function calls, duplicate `var`
  declarations, or broken closures.
- FullCalendar v6 `dateClick` **requires** both CDN scripts:
  ```html
  <script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/@fullcalendar/interaction@6.1.10/index.global.min.js'></script>
  ```
  And the calendar must be created with `selectable: true` — without it the
  interaction plugin won't activate and `dateClick` is silently dead.

---

## Auth & tenant pattern (never deviate from this)

```javascript
function _TID()         { return sessionStorage.getItem('vp_tenant_id') || '0'; }
function getAuthHeaders(){ return {}; }   // intentionally empty — CORS prevention
function tidUrl(base)   { return base + (base.includes('?') ? '&' : '?') + 'tenant_id=' + _TID(); }
```

- **GET calls**: append `tidUrl()` to the URL, no custom headers.
- **POST calls**: include `tenant_id: parseInt(_TID())` in the JSON body, headers `{}`.
- `vp_user` in sessionStorage is a **JSON string** like `{"name":"…","role":"…","tenant_id":1001}`.
  Always parse it: `JSON.parse(sessionStorage.getItem('vp_user') || '{}').name`.
  Never dump it raw into the DOM.

---

## Key API endpoints

| Purpose | Method | URL slug |
|---|---|---|
| All existing bookings (for calendar) | GET | `all-bookings` |
| Room list | GET | `get-rooms` |
| Event types | GET | `get-event-types` |
| Availability check | POST | `check-availability` |
| **Create recurring series** | POST | `create-recurring-booking` |

Full base URL: `https://n8n.srv1090894.hstgr.cloud/webhook/<slug>`

### Recurring booking payload

```javascript
{
  customer_name, customer_email, customer_phone,
  room_id, room_name,
  start_time, end_time,           // "HH:MM"
  start_date,                     // anchor date "YYYY-MM-DD"
  day_of_week,                    // 0=Sun … 6=Sat (from anchor date)
  frequency,                      // "weekly" | "fortnightly" | "monthly" | "daily"
  end_date,                       // "YYYY-MM-DD" or "" if specific_dates used
  specific_dates,                 // "YYYY-MM-DD,YYYY-MM-DD,…" or ""
  rate_per_session,               // float
  event_type, notes,
  tenant_id: parseInt(_TID()),
  performed_by                    // parsed from vp_user.name
}
```

---

## Mini-calendar column-drag system

This is the core UX innovation of the page. Understand it before editing.

### State variables

```javascript
var _rbSelected  = new Set();   // selected date strings "YYYY-MM-DD"
var _mcBaseYear  = new Date().getFullYear();
var _mcBaseMonth = new Date().getMonth();  // first of 3 visible months
var _drag        = { active: false, dow: -1, mode: 'add' };
// mode: 'add' when dragging to select, 'remove' when dragging to deselect
```

### How drag-selection works

Each rendered day cell carries `data-date="YYYY-MM-DD"` and `data-dow="0-6"`.

**`mcCellDown(e, cell)`** — fires on `pointerdown`:
- If Shift held: add mode, keep existing selection, start dragging new DOW column.
- If NOT Shift: clear all existing dates with that same weekday from `_rbSelected`,
  then start add-drag for the new column. If the cell was already selected,
  start remove-drag instead (allows deselecting a column).
- Always switches the page to "specific dates" mode automatically.

**`mcCellEnter(e, cell)`** — fires on `pointerenter` during drag:
- Only acts if `_drag.active` and the entering cell's DOW matches `_drag.dow`.
- Adds or removes the date depending on `_drag.mode`.

**End drag** — `document.addEventListener('pointerup', …)` sets `_drag.active = false`.

### Rendering

`rbBuildMiniCals()` calls `buildOneMonth(year, month)` three times, starting
from `_mcBaseYear / _mcBaseMonth`. Navigation buttons call `rbMcNav(±1)` which
shifts the base by 3 months at a time.

Cells get these CSS classes: `selected`, `past`, `empty`, `col-active` (drag preview).
The `transform: scale(1.08)` hover and `scale(1.05)` selected keep the cells feeling
tactile — don't remove these unless the user specifically asks.

### When to rebuild

Call `rbBuildMiniCals()` after:
- Any drag event that changes `_rbSelected`
- A date being clicked on the main FullCalendar
- `rbClearDates()` is called
- After a successful submission (reset)

Always call `rbRecalc()` after `rbBuildMiniCals()` to keep the preview in sync.

---

## Scheduling modes

The right panel has two tabs: **Auto-schedule** and **Specific dates**.

- **Auto-schedule**: shows frequency pills + start/end date fields. Uses
  `rbCalcDates(startDate, endDate, freq)` to compute the session list.
- **Specific dates**: shows a hint pointing to the mini-cals below.
  Uses `Array.from(_rbSelected).sort()` as the date list.

`rbSetMode('auto' | 'specific')` switches tabs and toggles the `specific-hint` div.
Dragging a mini-cal date auto-switches to specific mode.

Preview (`rbRecalc()`) always shows:
- In auto mode: total sessions, first-month count, first-month £ total.
- In specific mode: total selected, £ total (count × rate), date range.

---

## CSS colour conventions (dark theme)

The dark theme uses **white-lift** for interactive elements, not dark overlays.

| Element | Correct background | Wrong (don't use) |
|---|---|---|
| Day cells default | `rgba(255,255,255,.07)` | `rgba(0,0,0,.15)` |
| Form inputs | `rgba(255,255,255,.06)` | `rgba(0,0,0,.25)` |
| Nav/misc buttons | `rgba(255,255,255,.07)` | `rgba(0,0,0,.2)` |
| Month container | `rgba(255,255,255,.04)` | `rgba(0,0,0,.12)` |
| Input border | `rgba(148,163,184,.2)` | `var(--border)` alone |

Selected dates use `linear-gradient(135deg,#6366f1,#818cf8)` with a glow
box-shadow — keep this consistent.

Light mode: all `.cal-wrap`, `.panel`, `.mini-cals-section` get `background:#fff`.
Day cells get `background:#fff;color:#1e293b;border-color:#e8ecf0`.

---

## Syntax validation — run after every JS edit

```bash
node --input-type=module << 'EOF'
import { readFileSync } from 'fs';
const html = readFileSync('/sessions/zen-great-ritchie/mnt/venue_desk_backup/CommunityHub/recurring-bookings.html', 'utf8');
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
try { new Function(blocks); console.log('✓ JS syntax OK'); } catch(e) { console.error('JS error:', e.message); }
EOF
```

---

## Common extension tasks

### Adding a new form field

1. Add the HTML `<input>` inside `#booking-panel` following the `.form-group` /
   `.form-label` / `.form-input` pattern.
2. Read its value inside `rbSubmit()` and add it to `payload`.
3. If it needs to recalculate the preview (e.g. a rate-related field), call
   `rbRecalc()` on its `oninput`/`onchange`.

### Changing the number of visible months

Change the loop count in `rbBuildMiniCals()` and update the
`.mc-months-wrap` grid: `grid-template-columns: repeat(N, 1fr)`.

### Adding a new weekday selection mode

If adding something like "every other week starting from a specific weekday":
extend `_drag` state with an additional property and add handling in
`mcCellDown`. Keep `_rbSelected` as the single source of truth — never
maintain a parallel selection structure.

### Wiring a new n8n endpoint

Follow the POST pattern: `fetch(URL, { method:'POST', headers:{}, body: JSON.stringify({...payload, tenant_id: parseInt(_TID())}) })`.
No `Content-Type` header — it triggers CORS preflight. n8n accepts JSON without it.

---

## File location

```
venue_desk_backup/CommunityHub/recurring-bookings.html   ← the page
venue_desk_backup/n8n-workflows/                         ← workflow JSONs
```

The recurring series workflow is at the `create-recurring-booking` webhook path.
If that endpoint returns errors, check `8LTgEKbPIWNPy3QU.json` (Create Customer
Record) for the `valid_email` constraint — pass `NULLIF($2, '')` for the email
parameter so blank email doesn't violate the check constraint.

---

## References

- `references/fullcalendar-gotchas.md` — known FullCalendar v6 issues and fixes
- `references/venuedesk-css-tokens.md` — full CSS variable reference and component patterns
