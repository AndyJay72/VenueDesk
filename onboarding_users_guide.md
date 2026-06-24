# VenueDesk — Onboarding & Tenant Lifecycle Dashboard
## User Guide

**Version:** June 2026  
**Access:** `https://andyjay72.github.io/VenueDesk/onboarding.html`  
**Who this is for:** Super-admins who provision and manage venue accounts on the VenueDesk platform.

---

## Table of Contents

1. [What This Dashboard Does](#1-what-this-dashboard-does)
2. [Logging In](#2-logging-in)
3. [Reading the Telemetry Panel](#3-reading-the-telemetry-panel)
4. [The Venues Table](#4-the-venues-table)
5. [Onboarding a New Venue](#5-onboarding-a-new-venue)
6. [Editing a Venue](#6-editing-a-venue)
7. [Resetting a Password / Setting a Login](#7-resetting-a-password--setting-a-login)
8. [Activating and Deactivating Venues](#8-activating-and-deactivating-venues)
9. [Connecting to a Venue's Dashboard](#9-connecting-to-a-venues-dashboard)
10. [The System Audit Log](#10-the-system-audit-log)
11. [Subscription Status & Seat Allocation](#11-subscription-status--seat-allocation)
12. [Copying the Public Enquiry Link](#12-copying-the-public-enquiry-link)
13. [Session & Security Notes](#13-session--security-notes)

---

## 1. What This Dashboard Does

The Onboarding & Tenant Lifecycle Dashboard is the central control panel for the VenueDesk platform. From here you can:

- **Provision new venue accounts** — create the database records and staff login credentials for a new customer venue in one form.
- **Monitor platform health** — see live API latency and database status at a glance.
- **Manage existing tenants** — edit venue details, adjust seat allocations, reset passwords, activate or suspend accounts.
- **Impersonate a venue** — log directly into any venue's VenueDesk dashboard for support or setup purposes.
- **Review the system audit trail** — see a timestamped log of every admin action taken across the platform.

---

## 2. Logging In

1. Open the dashboard URL. You will see a login card with a single **Admin Key** field.
2. Enter the admin key (provided by your platform administrator).
3. Click **Access Dashboard** or press Enter.

The page verifies the key with the backend. If it is correct, the main dashboard loads immediately. If it fails, an error message appears below the button.

**Session behaviour:** Your session is stored only for the current browser tab/window. Closing the browser or tab logs you out automatically — you will need to re-enter the admin key next time. This is intentional for security.

---

## 3. Reading the Telemetry Panel

The glassmorphism bar at the top of the main area gives you a real-time view of platform health.

```
[ ● DB Health: Healthy ]  [ ~ 42 ms ]  [ Last Check: 14:32:07 ]  [ System Audit ]  [ ⚡ Ping ]
```

| Indicator | What it means |
|-----------|--------------|
| **DB Health dot — Green (pulsing)** | The last venue data load succeeded. The database layer is responding correctly. |
| **DB Health dot — Red (pulsing)** | The last venue data load failed. The database or API may be down. Try clicking Refresh. |
| **API Latency (ms)** | Round-trip time from your browser to the VenueDesk API (`api.venuedesk.co.uk`). Green = fast (< 300 ms), amber = acceptable (300–800 ms), red = slow or timing out. |
| **Last Check** | The time the most recent latency measurement was taken. This updates automatically every 30 seconds — you do not need to trigger it manually. |
| **System Audit button** | Opens the System Audit Log modal (see section 10). |
| **⚡ Ping button** | Manually triggers an immediate latency check. Useful after a network event or if you want a fresh reading. |

---

## 4. The Venues Table

The right-hand panel shows all registered venues. Each row contains:

| Column | Description |
|--------|-------------|
| **ID** | The internal tenant ID — a unique number (e.g. `#1001`) that identifies this venue throughout the platform. |
| **Venue / Slug** | The display name and the URL-safe slug used in booking links. |
| **Username** | The staff login username for this venue. If blank, no login has been created yet. |
| **Status** | Green **Active** badge or grey **Inactive** badge. Inactive venues cannot accept bookings. |
| **Subscription** | Colour-coded subscription tier badge — see section 11. |
| **Seats** | Staff seat allocation in the format `Seats: X / Y` — see section 11. |
| **Actions** | Quick-action buttons for Edit, Open detail panel, Copy enquiry link, Key (reset password), and Pause/Play (toggle active state). |

Click anywhere on a row to open the **Venue Detail Panel** for that venue.

---

## 5. Onboarding a New Venue

The left-hand card is the **Onboard New Venue** form. Fill in each field:

| Field | Notes |
|-------|-------|
| **Tenant / Venue ID** | Auto-suggested as the next available number (e.g. if you have venues up to `#1003`, this prefills as `1004`). Must be 1000 or above. You can change it, but make sure it does not clash with an existing ID. |
| **Venue Name** | The full display name of the venue, e.g. `The Park Suite`. |
| **Slug** | Auto-filled as you type the venue name. This becomes part of the booking form URL: `enquiry-form.html?t=1004`. You can edit it manually — lowercase letters, numbers and hyphens only. |
| **Admin Username** | The login username the venue manager will use. Typically the venue name in lowercase with no spaces, e.g. `parksuite`. |
| **Contact Name** | The full name of the primary contact at the venue, e.g. `Jane Smith`. This appears on their dashboard. |
| **Password** | The initial login password. Must be at least 6 characters. Tell the venue manager this password securely and ask them to change it after first login. |

### Staff Seats stepper

Below the password field is the **Staff Seats** stepper:

```
[ − ]  [ 2 ]  [ + ]   staff accounts included

Monthly: £35.00  (£30 base + 1 × £5 extra seats)
```

- Click **+** to increase the number of staff accounts this venue is licensed for.
- Click **−** to decrease (minimum 1).
- The **Monthly Revenue Preview** updates instantly to show the total: £30 for 1 seat, +£5 for each additional seat.
- This seat count is stored against the venue record so you can track licensing.

### Creating the venue

Click **Create Venue Account**. The button shows a spinner while the request processes. On success, a green toast notification confirms the venue was created, the form clears, and the venue appears in the table. If anything fails, a red toast shows the error message.

---

## 6. Editing a Venue

Click the **Edit** button on any table row (or **Edit Details** inside the Venue Detail Panel).

The Edit Venue modal lets you update:
- **Venue Name** — updates the display name everywhere.
- **Slug** — auto-updates as you type the name, or edit manually.
- **Contact Name** — updates the staff display name.
- **Staff Seats** — same stepper as the create form. Adjust up or down and the pricing preview updates.

Click **Save Changes** to apply. The table refreshes automatically.

---

## 7. Resetting a Password / Setting a Login

Click the **🔑** (key) button on a venue row, or **Reset Password** / **Set Login** in the Venue Detail Panel.

**If the venue already has a username** (Reset Password mode):
- Enter a new password (minimum 6 characters) and click **Reset Password**.
- The username does not change.

**If the venue has no username yet** (Set Login mode):
- Enter a new username and password, then click **Set Login**.
- A new staff user account is created for this venue.

---

## 8. Activating and Deactivating Venues

Click the **⏸ Pause** button to deactivate an active venue, or the **▶ Play** button to reactivate an inactive one. A confirmation prompt appears before the change is applied.

**What deactivation does:**
- Sets the venue's `active` flag to false.
- The venue's booking form will reject new enquiries.
- Staff can still log into the venue dashboard (it is a soft deactivation).
- The row badge changes to grey **Inactive**.

**What reactivation does:** Reverses the above. The venue immediately accepts new enquiries.

---

## 9. Connecting to a Venue's Dashboard

The Venue Detail Panel (click any row to open it) provides a full **Setup & Manage Venue** grid with quick-launch buttons for every section of that venue's dashboard:

| Button | Opens |
|--------|-------|
| 🏨 Rooms & Pricing | The admin config page for rooms, rates, and event types |
| 📅 Calendar | The booking calendar |
| 👥 Customers | The customer records list |
| 📋 Bookings | All confirmed bookings |
| 📊 Accounts | Payments and outstanding balances |
| ✍️ Manual Booking | The manual booking creation form |
| **Connect to Full Dashboard** (purple button) | The main staff dashboard (index.html) |

Clicking any of these buttons opens a **new tab** pre-authenticated as that venue. You will see that venue's data as if you were logged in as their admin. Close the tab to return to the onboarding dashboard.

> **Note:** This impersonation uses a platform-level token, not the venue's own password. Changes you make in the connected tab are real and affect live data.

---

## 10. The System Audit Log

Click the **System Audit** button in the telemetry panel to open the audit log modal.

The modal fetches the latest platform-wide admin action log and displays it as a table:

| Column | Description |
|--------|-------------|
| **Timestamp** | Date and time the action occurred. |
| **Action** | The type of admin operation — e.g. `create_venue`, `reset_password`, `toggle_venue`. |
| **Target Tenant** | The venue ID that was affected by the action. |
| **Admin** | The admin account that performed the action (currently `super-admin`). |
| **Details** | A human-readable summary of what changed. |

Click **Refresh** inside the modal to reload the log. Close with the × button or by clicking the dimmed background.

> **If the log shows "Failed to load logs":** The system logs endpoint may not yet be enabled on the API server. This is a known pending item — the frontend is ready and will populate automatically once the backend endpoint is active.

---

## 11. Subscription Status & Seat Allocation

These two columns in the venues table are driven by data returned from the platform database. They will show `—` until the backend is updated to return those fields.

### Subscription Status badges

| Badge | Colour | Meaning |
|-------|--------|---------|
| **Active** | Green | Venue is on a paid, current subscription. |
| **Trial** | Indigo/blue | Venue is in a free trial period. |
| **Past Due** | Red | Venue's payment is overdue. May require intervention. |
| `—` | Grey text | No subscription data returned by the API yet. |

### Seat Allocation

Displayed as `Seats: X / Y` where:
- **X** = number of currently active staff user accounts for this venue.
- **Y** = the maximum seats licensed (`max_users` field, set when onboarding or editing the venue).

If either value is missing from the API response, the cell shows `—`.

**Managing seats:** Use the Staff Seats stepper in the Edit modal to increase or decrease a venue's `max_users` allocation. This sends the updated value to the database. The table refreshes after saving.

---

## 12. Copying the Public Enquiry Link

Every venue has a public-facing enquiry form URL. Click the **🔗 Enquiry Link** button on any venue row to copy it to your clipboard.

The link takes the format:
```
https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=<tenant_id>
```

Share this link with a venue so they can embed it on their website, or include it in their marketing. When a member of the public submits this form, the enquiry is routed directly to that venue's dashboard.

---

## 13. Session & Security Notes

- **Your session expires when you close the browser.** `vd_admin_auth` is stored in `sessionStorage`, not `localStorage`. There is no "remember me" — this is deliberate.
- **The admin key is visible in browser developer tools.** The onboarding dashboard is intended for internal admin use only. Do not share the URL publicly.
- **Every admin action is logged.** Create, reset-password, and toggle-venue operations all write an entry to the system audit log automatically in the background. You do not need to do anything to enable this.
- **Connecting to a venue tab opens a live session.** Anything you do in that tab (create a booking, edit a customer, etc.) is real and permanent.
- **The 30-second latency check** sends a lightweight ping to `api.venuedesk.co.uk/health/ping` from your browser. It does not transmit any credentials or venue data.

---

*For technical documentation on the underlying architecture, API endpoints, and workflow configuration, see `CLAUDE.md` → `onboarding.html — Architecture Reference`.*
