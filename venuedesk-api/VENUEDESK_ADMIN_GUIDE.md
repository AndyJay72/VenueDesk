# VenueDesk — Administrator Operations Guide

**Audience:** Operations team, venue managers, and front-desk staff  
**Scope:** Day-to-day platform management — no technical knowledge required  
**Last updated:** June 2026

---

> **How to use this guide**
> Each section is self-contained. Jump directly to the topic you need using the headings below.
> Warning boxes highlight actions that cannot be undone or that have system-wide consequences.

---

## Table of Contents

1. [Room & Venue Setup Rules](#1-room--venue-setup-rules)
2. [Managing Bookings & Handling Errors](#2-managing-bookings--handling-errors)
3. [Troubleshooting Matrix](#3-troubleshooting-matrix)
4. [n8n Automation Engine & Mail Statuses](#4-n8n-automation-engine--mail-statuses)
5. [Payment Configuration (Stripe & BACS)](#5-payment-configuration-stripe--bacs)

---

---

## 1. Room & Venue Setup Rules

### Adding a New Room

To create a room on the platform, navigate to the **Config Manager** in the dashboard and complete the room form. The following fields are available:

| Field | Required | What it does |
|-------|----------|--------------|
| **Name** | Yes | The public-facing room label. Must be unique — the system will reject a duplicate name. |
| **Capacity** | No | The maximum number of guests allowed. See the Capacity Rule below. |
| **Day Rate** | No | Full-day hire price (used for pricing calculations). |
| **Half Rate** | No | Half-day hire price. |
| **Description** | No | Internal notes or marketing copy for the room. |

Once saved, the room becomes immediately bookable and visible in the calendar.

---

### The Capacity Rule

> **This is one of the most important settings on the platform. Read carefully.**

The **capacity** field controls whether the platform enforces a guest count ceiling on bookings for that room.

#### Capacity = 0 (Unconstrained / Legacy Mode)

- Setting capacity to **0** tells the system: *"there is no guest limit for this room."*
- Any number of guests can be assigned to a booking without the system blocking it.
- This is the default for rooms created without specifying a capacity.
- Use this for rooms where physical occupancy is managed manually (e.g. outdoor spaces, flexible layouts).

#### Capacity ≥ 1 (Strictly Enforced Ceiling)

- Setting capacity to **any number 1 or above** activates a hard enforcement ceiling.
- If a booking is submitted with a guest count that **exceeds this number**, the system will automatically reject it with an error.
- This applies even if the staff member submitting the booking has admin privileges — the rule is enforced at the database level.

#### Practical examples

| Room | Capacity Setting | What happens when booking with 60 guests |
|------|-----------------|------------------------------------------|
| Main Hall | 0 | Booking accepted — no guest check |
| Conference Suite | 50 | **Booking rejected** — 60 > 50 |
| Garden Terrace | 100 | Booking accepted — 60 ≤ 100 |

> **⚠️ Warning — Changing Capacity Retroactively**
> Updating a room's capacity does **not** affect existing bookings. Historical bookings already in the system are untouched. However, any new booking submitted after the change will be subject to the new limit. If you reduce a room's capacity, communicate this to your team before making the change.

---

### Deactivating (Soft-Deleting) a Room

Rooms are never permanently deleted — they are **deactivated**. This protects the historical booking records linked to that room.

- A deactivated room disappears from the booking form and calendar view.
- All past bookings for that room remain intact in the database and in reports.
- The room can be reactivated at any time by setting it back to active.

> **⚠️ Warning — Deactivation is not cancellation**
> Deactivating a room does not cancel existing future bookings for that room. You must cancel those bookings manually before deactivating, otherwise they will remain in the system as orphaned records.

---

### Adding Event Types & Pricing

Event types (e.g. "Wedding", "Corporate Meeting", "Birthday Party") are managed separately from rooms and can be configured with per-room pricing rules. To set up:

1. Navigate to **Config → Event Types** to create an event type.
2. Navigate to **Config → Pricing** to link an event type to a specific room with a price.

Each room-and-event-type combination can have its own rate, giving you full pricing flexibility.

---

---

## 2. Managing Bookings & Handling Errors

### The 90-Day Shield

> **The platform completely blocks any single booking block spanning more than 90 consecutive days.**

This rule exists to protect your venue inventory from accidental "infinite holds" and to ensure that long-term contracts are reviewed and broken into manageable segments.

**What triggers this block:**
- A booking where the end date is more than 90 days after the start date
- This applies to both one-off bookings and blocks created from recurring series

**What the client or staff member will see:**
> *"Booking duration exceeds maximum allowed limit of 90 days."*

**How to advise clients with long-term needs:**

For clients who need a space for longer than 90 days (e.g. a weekly class that runs for a full year), instruct them to:

1. Break the requirement into **independent recurring series blocks** — for example, one block per quarter.
2. Create each block separately through the booking form.
3. Each block will have its own booking reference, payment schedule, and cancellation record.

This is the intended workflow. There is no override or workaround for the 90-day ceiling — it is enforced at the server level.

---

### The Clock Rule

> **The system aggressively rejects any booking dated in the past.**

Reservations must always start **today or in the future**. This applies to both the booking date and the start of any date range.

**What triggers this block:**
- Submitting a booking with a date that has already passed (even by one day)
- Importing or bulk-loading historical data through the standard booking form

**What the staff member will see:**
> *"Cannot create or register a venue reservation block in the past."*

**Legitimate use cases for historical records:**

If your operations team needs to backfill historical data (e.g. migrating records from a previous system), this must be handled by the technical team directly — it cannot be done through the standard dashboard interface.

---

### Booking Status Glossary

Every booking in the system carries a **status** that tells the platform and your team the current state of that reservation. Only the exact values in this glossary are accepted — any other word will be rejected.

---

#### `pending`
**Plain English:** *We have received this enquiry or request. No action has been taken yet.*

- A booking or enquiry request is sitting in the queue waiting for a staff member to review it.
- The room slot is not yet formally held for this customer.
- Typical next step: review with the client and move to `provisional` or `confirmed`.

---

#### `provisional`
**Plain English:** *We are holding this slot informally while the client decides.*

- The booking is a soft hold — the slot is tentatively reserved but can be released.
- No deposit or payment has been received.
- Use this when a client has verbally expressed intent but has not yet committed.
- Typical next step: receive deposit and move to `deposit_paid`, or confirm directly with `confirmed`.

---

#### `deposit_paid`
**Plain English:** *The client has paid the deposit. The booking is financially secured at the deposit level.*

- A deposit payment has been received and recorded against this booking.
- The room is now held firmly for this customer.
- The balance remains outstanding.
- This status is often set automatically when Stripe processes a deposit payment.

---

#### `paid`
**Plain English:** *A payment has been received, but the full financial picture has not yet been formally verified.*

- A general-purpose "payment received" marker.
- Used when recording manual or partial payments that do not yet satisfy the full balance.

---

#### `fully_paid`
**Plain English:** *The client has paid in full. Nothing is outstanding.*

- The total amount has been settled.
- No balance is due.
- This status can be set automatically when a final Stripe payment completes.

---

#### `confirmed`
**Plain English:** *This booking is locked in. It appears on the calendar and holds the room.*

- The booking is fully secured and active in the system.
- This is the status used for the vast majority of completed bookings.
- A `confirmed` booking blocks the room slot from being taken by anyone else.
- This is the default status when a booking is created without specifying otherwise.

---

#### `cancelled`

> **⚠️ WARNING — This action is permanent and immediately releases the room.**

**Plain English:** *This booking has been formally abandoned. The room is now available to anyone.*

- Cancelling a booking **immediately and permanently frees** the room, date, and time slot back into the public availability pool.
- Another client can book that exact slot the moment this status is applied.
- The booking record is retained in the database for audit and reporting purposes — it is never deleted.
- **Do not cancel a booking unless you are certain the client will not be returning.**

Typical use: client has formally withdrawn, payment has been refunded or waived.

---

#### `overridden`
**Plain English:** *An administrator has manually forced this booking into the system, bypassing the normal rules.*

- Reserved for special administrative situations (e.g. restoring a booking that was incorrectly cancelled, resolving a system conflict, accommodating a VIP arrangement).
- This status bypasses certain automatic checks.
- **Should only be applied by an authorised manager.** Its use is logged and auditable.

---

---

## 3. Troubleshooting Matrix

Use this table when staff report errors during booking or when the dashboard shows unexpected behaviour. Match what is visible on screen to the resolution steps.

---

### Quick Reference Table

| What you see on screen | System error code | Root cause | Resolution |
|------------------------|------------------|------------|------------|
| "Room is already booked for this date/time" | 409 Conflict or Network Reset | Double-booking collision — another booking locked that slot | See Detail 3.1 below |
| "Guest count exceeds room capacity" | 400 Bad Request | Guest count is higher than the room's strict ceiling | See Detail 3.2 below |
| "Invalid status value" | 400 Bad Request | A status word not in the approved glossary was submitted | See Detail 3.3 below |
| "Cannot create or register a venue reservation block in the past" | 400 Bad Request | The booking date is today or earlier | Advise client the date must be in the future |
| "Booking duration exceeds maximum allowed limit of 90 days" | 400 Bad Request | The date range spans more than 90 consecutive days | Break the booking into multiple shorter blocks (see The 90-Day Shield) |
| "guest_count must be at least 1" | 400 Bad Request | A guest count of zero was submitted | Correct the guest count to 1 or more, or leave the field blank |
| "end_time must be after start_time" | 422 Unprocessable | The end time is equal to or earlier than the start time | Correct the time fields |
| Dashboard shows blank / no data | — | Session token expired or missing claims | Log out, log back in; token will be refreshed |
| Booking form rejects a valid UUID | 400 Bad Request | Malformed ID in the request | Reload the page and re-select the customer/room from the dropdown |

---

### Detail 3.1 — "Room is already booked for this date/time" (409 / Network Reset)

**What is happening:**

Two staff members (or two browser tabs) submitted a booking for the exact same room, date, and time slot within milliseconds of each other. The platform's automatic collision detection — a database-level lock — blocked the second submission to prevent a double-booking. This is the system working correctly.

You may sometimes see this as a network connection reset rather than a clean error message. Both mean the same thing: the slot was already taken before your submission completed.

**Admin resolution steps:**

1. **Refresh the dashboard** or the booking calendar — the conflicting booking will now appear in the calendar for that room.
2. Check with the client whether they are flexible on time or room.
3. **Select an alternative time slot** (even 15 minutes earlier or later can be sufficient) **or a different room** that is free for their required period.
4. **Re-submit the booking** with the adjusted details.

> **Do not repeatedly retry the same slot** — the system will reject it every time if it is genuinely occupied.

---

### Detail 3.2 — "Guest count exceeds room capacity" (400)

**What is happening:**

The booking form has been submitted with a guest count that is higher than the hard ceiling configured for that room. For example, submitting a booking for 65 guests into a room with a strict capacity of 50 will always be rejected.

**Admin resolution steps:**

**Option A — Upgrade to a larger room:**
1. Check the room list for an alternative venue with sufficient capacity.
2. Return to the booking form, change the room selection, and re-submit.

**Option B — Adjust the room's capacity setting (if the physical space permits):**
1. Navigate to **Config → Rooms**.
2. Find the room in question and edit it.
3. Increase the capacity to reflect the actual maximum the space can safely hold.
4. Save the change, then return to the booking form and re-submit.

> **⚠️ Only increase capacity if the physical venue can genuinely accommodate the higher number.** Overriding this setting for convenience could create a liability issue if the space is overcrowded.

---

### Detail 3.3 — "Invalid status value" (400)

**What is happening:**

A booking update was submitted with a status value that the system does not recognise. This typically happens when:

- An external integration or automation workflow uses a custom label (e.g. `"complete"`, `"active"`, `"reserved"`) that is not in the approved glossary.
- A manual form entry contains a typo or a status word from a previous system.

**Admin resolution steps:**

1. Open the booking in question.
2. Check the **Status** field — confirm it is set to one of the exact values from the glossary:
   - `pending`
   - `provisional`
   - `deposit_paid`
   - `paid`
   - `fully_paid`
   - `confirmed`
   - `cancelled`
   - `overridden`
3. Correct the value and re-save.

If this error is appearing from an automated workflow rather than a manual entry, escalate to the technical team to audit the n8n workflow that is generating the bad status value.

---

---

## 4. n8n Automation Engine & Mail Statuses

### What is n8n?

Behind every automated action on the VenueDesk platform — confirmation emails, payment reminders, expiry warnings, and calendar syncs — sits **n8n**, the workflow automation engine. It runs silently in the background and handles all the tasks that do not require a human to click a button.

Staff and administrators do not need to interact with n8n during normal operations. However, when automated emails stop sending or scheduled tasks appear to have stopped running, this section explains where to look.

---

### Accessing n8n

n8n is accessible at:

> **https://n8n.srv1090894.hstgr.cloud**

You will need your n8n administrator credentials to log in.

---

### What n8n Handles Automatically

| Automation | What it does |
|------------|--------------|
| **Booking confirmation emails** | Sends a confirmation to the client when a booking reaches `confirmed` or `deposit_paid` status |
| **Payment reminders** | Sends balance-due reminders as a booking date approaches |
| **Enquiry acknowledgements** | Sends a "we've received your enquiry" email when a new booking request is submitted |
| **Expiry warnings** | Flags provisional bookings that have been sitting unclaimed beyond a set number of days |
| **Stripe webhook processing** | Listens for Stripe payment events and automatically updates booking statuses |
| **Cycle sweeps** | Scheduled overnight jobs that tidy up expired sessions and stale records |

---

### When Automated Emails Stop Sending

If a member of staff reports that clients are not receiving confirmation or reminder emails, follow this checklist in order:

**Step 1 — Check the workflow is active**

1. Log in to n8n at the URL above.
2. In the left navigation, click **Workflows**.
3. Locate the relevant workflow (e.g. "VenuePro - Booking Confirmation Email", "VenuePro - Payment Reminder").
4. Look at the toggle switch in the top-right corner of the workflow card.
   - If the toggle is **grey / off**: the workflow is paused. Click the toggle to activate it.
   - If the toggle is **green / on**: the workflow is active — move to Step 2.

> **⚠️ Workflows are occasionally deactivated when editing.** If a technical team member recently made changes to a workflow, they may have accidentally left it in draft/inactive state.

---

**Step 2 — Check the email node credentials**

1. Open the workflow that handles the failing email.
2. Click on the **Send Email** node (it will have an envelope icon).
3. In the node settings panel, look for the **Credentials** field.
4. The credentials must be set to **"Hostinger SMTP"**.
   - If the field is blank or shows a different credential name: click the dropdown and select **Hostinger SMTP**.
   - If "Hostinger SMTP" does not appear in the dropdown: the credential has been deleted or renamed. Escalate to the technical team immediately.
5. Click **Save** on the node and re-activate the workflow.

> **⚠️ Do not create new SMTP credential entries** unless instructed by the technical team. Using the wrong SMTP configuration can cause emails to be delivered from the wrong sender address or trigger spam filters.

---

**Step 3 — Check recent execution history**

If the workflow is active and the credentials look correct, check whether recent executions have been failing:

1. Open the workflow.
2. Click **Executions** in the top navigation bar.
3. Look for any runs marked with a **red dot** or **"Error"** label.
4. Click on a failed execution to see the error message.
5. Take a screenshot of the error and send it to the technical team for investigation.

---

### When Scheduled Tasks Appear to Have Stopped

Some n8n workflows run on a schedule (e.g. nightly at midnight) rather than being triggered by a booking event. If a nightly task appears to have missed a run:

1. Check the workflow is **Active** (Step 1 above).
2. Check the **Executions** tab for the most recent run — it may have succeeded but produced no visible output (e.g. no expired records to process).
3. If the last successful execution is more than 48 hours ago and the workflow is active, escalate to the technical team.

---

### Summary: n8n First-Response Checklist

```
[ ] Is the workflow toggled to Active (green)?
[ ] Is the email node using "Hostinger SMTP" credentials?
[ ] Are recent executions showing errors?
[ ] Was the workflow recently edited (could be in draft state)?
[ ] Has more than 48 hours passed since the last successful run?
```

If all five checks pass and the problem persists, escalate to the technical team with a screenshot of the Executions tab.

---

---

---

---

## 5. Payment Configuration (Stripe & BACS)

### Where to find it

Navigate to **Config → Payments** in the dashboard sidebar. The Payments tab is split into two cards:

- **Left card — Stripe Payments:** online card payment processing
- **Right card — BACS Bank Transfer:** bank transfer details shown to customers who choose to pay manually

---

### Stripe Card Payments

#### Enabling / Disabling Stripe

The toggle at the top of the Stripe card controls whether Stripe card payment is offered to customers during booking. Flip the toggle on or off and then click **Save Stripe Settings** to apply.

> **⚠️ Disabling Stripe does not cancel existing payment sessions.** Any Stripe Checkout links already sent to customers will continue to work until they expire. Disable Stripe only if you intend to stop accepting online card payments going forward.

---

#### Setting Up Stripe Keys

To accept card payments you need two keys from your Stripe Dashboard, plus one webhook signing secret. Set them up once — they are stored securely and never displayed again.

**Step 1 — Publishable Key**

The publishable key is safe to store in the browser and is used to initialise Stripe's payment form. It starts with `pk_live_` (production) or `pk_test_` (test mode).

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com/apikeys).
2. Copy the **Publishable key**.
3. Paste it into the **Publishable Key** field on the Payments tab.

**Step 2 — Secret Key**

The secret key is write-only — once saved it is never shown again, only a green "saved ✓" badge confirms it is stored. It starts with `sk_live_` or `sk_test_`.

1. From the same Stripe API Keys page, copy the **Secret key**.
2. Paste it into the **Secret Key** field.
3. Click **Save Stripe Settings**.

> **⚠️ Leave the Secret Key field blank** if you only want to update other settings (e.g. toggle or publishable key). A blank secret key field means "keep the current one" — it does not overwrite or clear the stored key.

**Step 3 — Webhook Signing Secret (one-time setup)**

The webhook secret lets the platform verify that payment notifications really came from Stripe and have not been tampered with.

1. In your Stripe Dashboard, go to **Developers → Webhooks → Add endpoint**.
2. Set the **Endpoint URL** to:
   ```
   https://api.venuedesk.co.uk/stripe/webhook
   ```
3. Under **Events to listen to**, select **checkout.session.completed**.
4. Click **Add endpoint**.
5. On the endpoint detail page, click **Reveal** under *Signing secret* to show the `whsec_...` value.
6. Copy it and paste it into the **Webhook Signing Secret** field on the Payments tab.
7. Click **Save Stripe Settings**.

The webhook secret field is also write-only — a green "Webhook: saved ✓" badge will appear once it is stored.

---

#### Key Status Badges

Below the key fields you will see two status indicators:

| Badge | Meaning |
|-------|---------|
| 🟢 Secret key: saved ✓ | A secret key is stored in the system. |
| ⚫ Secret key: not set | No secret key has been saved yet. Card payments will fail. |
| 🟢 Webhook: saved ✓ | A webhook signing secret is stored. Payment confirmations will be received. |
| ⚫ Webhook: not set | No webhook secret stored. Stripe payment events will not be processed. |

If both badges are green and the toggle is on, Stripe card payment is fully operational.

---

### BACS Bank Transfer

The BACS card stores the bank details shown to customers who choose to pay by bank transfer (e.g. on the booking confirmation page or in a payment reminder email).

| Field | What to enter |
|-------|---------------|
| **Account Name** | The name on the bank account (e.g. "Village Hall Management Committee") |
| **Sort Code** | Six-digit sort code in `00-00-00` format |
| **Account Number** | Eight-digit account number |

Click **Save BACS Details** after filling in or updating any of the fields.

> **Note:** BACS details are for display only — the platform does not verify that a bank transfer has been received. When a BACS payment arrives in your bank account, a staff member must manually update the booking's payment status in the dashboard.

---

### Frequently Asked Questions

**Q: I updated the secret key — why does the field go blank after saving?**

A: This is intentional. Secret keys are write-only. Once saved, the system confirms storage with the green badge. The field clears so the key is not left visible on screen. The stored value has not changed.

**Q: I want to switch from test mode to live mode. What do I need to change?**

A: Replace both the Publishable Key (`pk_test_...` → `pk_live_...`) and the Secret Key (`sk_test_...` → `sk_live_...`). You also need to create a new live-mode webhook endpoint in your Stripe Dashboard and paste the new `whsec_...` signing secret. Submit all three fields in one **Save Stripe Settings** click.

**Q: Can I have both Stripe and BACS active at the same time?**

A: Yes. The two payment methods are independent. Customers are offered whichever options are configured and enabled.

---

*End of VenueDesk Administrator Operations Guide*

*For technical issues beyond the scope of this guide, contact your technical team or raise a ticket referencing the error code and the troubleshooting step reached.*
