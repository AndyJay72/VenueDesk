# VenueDesk Staff User Guide – How to Manage Bookings, Customers & Payments

> **Last updated:** June 30 2026 · **Audience:** Non-technical venue staff  
> **Live site:** https://andyjay72.github.io/VenueDesk

---

## Quick Reference Table

| Task | Where to go | Key button / action |
|------|-------------|---------------------|
| Make a booking (planned enquiry) | **Calendar** → click a day | **Record Deposit / Full Payment / Save as Pending** |
| Make a booking (walk-in / on-site) | **Walk-In Booking** page | **Confirm Booking** button |
| Book half, third, or quarter of a room | **Calendar** → click a day → Room dropdown | Select the partition (e.g. "North Half") |
| Add notes to a customer or booking | **Customers** → click customer → Log Interaction | **Save Interaction** |
| View bookings (calendar view) | **Calendar** in sidebar | Month (chips) / Week & Day (time-block grid) / List tabs |
| View bookings (filterable list) | **Bookings** in sidebar | Filter buttons at top |
| Set up recurring payments | **Recurring** in sidebar | **Record Payment** on a series card |
| Cancel a booking | **Bookings** → Cancel button | Confirm in the pop-up dialog |
| Cancel a full recurring series | **Bookings → Recurring Series** tab | **Cancel** on individual sessions |
| Record a manual payment | **Bookings** → **Pay** button | Choose method → **Confirm Payment** |
| View payment history / invoices | **Accounts** in sidebar | Click any transaction row |
| Set up a divisible room | **Admin Config** → Rooms tab | Add room → set Parent Room + Position |
| Check what email a customer was sent | **Audit Log** → filter by customer name | See email events in the activity log |

---

## Getting Started

After logging in you will land on the **Dashboard**. The left-hand sidebar is your main navigation. On desktop the sidebar is always visible; on tablets and phones tap the **☰ menu icon** in the top-left corner to open it.

**Sidebar links:**

| Icon | Link | What it does |
|------|------|--------------|
| Chart-pie | **Dashboard** | Overview: pending requests, upcoming events, recent interactions |
| Calendar-alt | **Calendar** | Full venue calendar + quick booking modal |
| Chart-line | **Bookings** | Filterable list of all bookings |
| Repeat | **Recurring** | Manage recurring series and record monthly payments |
| Invoice | **Accounts** | Transaction history and invoices |
| Users | **Customers** | Full customer CRM |
| Walk-in arrow | **Walk-In Booking** | Fast form for on-site bookings |
| File-pen | **New Booking** | Online enquiry form (opens in new tab) |
| Clock | **Audit Log** | System audit trail |

---

## 1. Making a Booking

There are **three ways** to create a booking depending on the situation.

---

### Option A — Quick Booking via the Calendar (most common)

Use this when a customer contacts you in advance and you want to check availability and book in one step.

1. Click **Calendar** in the sidebar.
2. The calendar loads showing all current bookings colour-coded by room.
3. **Click on the date** you want to book. A **Quick Booking** panel slides open on the right.
4. Fill in the form:
   - **Customer** – type the customer's name and phone number (email optional).
   - **Room** – select from the dropdown. Available rooms for that date are shown. If your venue uses divisible spaces (see Section 6), you will see both the full room and its partitions (North Half, 1st Third, etc.) listed separately.
   - **Event Type** – select from the dropdown (e.g. Meeting, Party, Workshop).
   - **Start Time / End Time** – pick from the dropdowns. The **availability status** bar updates automatically:
     - 🟢 **Available** – slot is free, you can proceed.
     - 🔴 **Unavailable** – another booking exists, or the time falls outside the room's operating hours. Choose different times.
     - If the room has set operating hours, the panel shows them as a hint (e.g. "Main Hall operating hours: 09:00 – 21:00") and rejects out-of-hours selections without a server round-trip.
   - **Number of Guests** – enter the expected guest count. A warning appears if it exceeds the room's capacity.
   - **Notes** – optional, e.g. "requires projector".
   - **Multi-day event?** – click **"Requires multiple days"** to reveal **Date From / Date To** fields. Maximum span is 90 days.
5. The **Total Cost** calculates automatically based on room, event type, and duration.
6. Choose how to record the booking:
   - **Record Deposit** – takes a partial payment now; balance remains due.
   - **Full Payment** – marks the booking as fully paid.
   - **Save as Pending** – saves the booking without any payment (staff to follow up later).
7. The booking appears on the calendar immediately.

> **Tip:** You can also use the calendar to set up a **recurring booking** (see Section 4).

---

### Option B — Walk-In Booking (customer is on-site right now)

Use this for drop-in customers who need to be booked quickly at the front desk.

1. Click **Walk-In Booking** in the sidebar.
2. Under **Customer Details**, enter:
   - **Full Name** *(required)*
   - **Phone** *(required)*
   - **Email** *(optional)*
3. Under **Event Details**, fill in:
   - **Room** *(required)*
   - **Event Type** *(optional – for pricing)*
   - **Event Date** *(required – today or future dates only)*
   - **Number of Guests** *(required)*
   - **Start Time / End Time** *(required)*
   - **Notes** *(optional)*
4. The **availability status bar** shows whether the slot is free. If the selected room has operating hours configured, a hint strip appears below the time dropdowns showing the valid window (e.g. "Main Hall operating hours: 09:00 – 21:00"). Choosing a time outside those hours marks the slot unavailable immediately, before any server check.
5. The **Total Cost** box calculates automatically.
6. Under **Payment**, select the payment method (Cash, Card, Bank Transfer, etc.).
7. Choose an action:
   - **Cash Payment** (amber button) – records a cash payment and confirms the booking.
   - **Confirm Booking** (green button) – confirms with card/bank payment.

> **Walk-in bookings cannot be made for past dates.** If you try, a red error message will appear.

---

### Option C — New Booking Enquiry Form

Use this to send the online enquiry form link to a customer, or to fill it in yourself during a telephone enquiry.

#### Finding and sharing the form URL

The form URL follows this format:

```
https://andyjay72.github.io/VenueDesk/enquiry-form.html?t=<tenant_id>
```

The `?t=` parameter is your venue's **Tenant ID** — a 4-digit number (e.g. `?t=1001`). You can find it in **Admin Config** → any settings page (it appears in API requests), or ask your administrator. If the `?t=` parameter is missing or invalid, visitors see an "Invalid Venue Link" error — always include it when sharing.

**Quick access:** Click **New Booking** in the sidebar. This opens the correct pre-configured link in a new tab. You can copy the URL from the address bar and share it with customers by email, WhatsApp, or your website.

---

#### What the form collects

**Contact Details** (all required)

| Field | Notes |
|-------|-------|
| Full Name | Customer's full name |
| Email | Used to identify returning customers |
| Phone | Primary contact number |

**Event Details** (required unless noted)

| Field | Notes |
|-------|-------|
| Preferred Room | Loaded from your room list; shows capacity (e.g. "Main Hall (Cap: 100)") |
| Event Type | Loaded from your event types list |
| Event Date | Single date picker; minimum date is today |
| Start Time / End Time | 30-minute slot dropdowns, 08:00–23:00 |
| Number of Guests | Integer; checked against room capacity |
| Notes | Optional — special requirements, accessibility needs, etc. |

**Additional Rooms** (optional)

If your venue has more than one room, a checkbox list appears below the primary room dropdown. Each additional room shows its hourly rate (`+£X.XX/hr`). Customers can tick one or more rooms to include them in the enquiry — this affects the cost estimate and is included in the booking request.

**Multi-day events**

A **"Requires multiple days"** toggle appears next to the date field. When active:
- The single date picker is replaced by **Date From** and **Date To** fields
- Maximum span is 90 days (the form shows an error if this is exceeded)
- Cost estimate multiplies by the number of days

---

#### Real-time cost estimate

As the customer fills in the form, a cost estimate appears automatically:

> `£12.50/hr [+ 1 room] × 4.0h × 2 days = £100.00`

This is an **estimate only** — the confirmed price is set when staff convert the enquiry. The estimate is based on `rooms.day_rate` (an hourly rate) × hours × days, plus any additional rooms. If no rate is configured for the room, the cost panel is hidden.

---

#### Availability check

Once a room, date, and times are all selected, the form automatically checks availability:

- 🟢 **Available** — date and time slot is free for that room. Submit buttons activate.
- 🔴 **Unavailable** — slot is already booked. Customer must choose different times or dates.

The check also catches:
- Blocked dates (venue closed days, one-off closures, date ranges)
- End time not after start time
- Date range exceeding 90 days
- **Room operating hours** — if the selected room has set open/close times, the form shows a hint strip ("Main Hall operating hours: 09:00 – 21:00") as soon as the room is chosen, and immediately marks the slot unavailable if the chosen start or end time is outside those hours — without waiting for a server round-trip

The form sends a `POST /webhook/check-availability` to confirm against existing bookings.

---

#### Submission options

The customer has two ways to submit, depending on whether Stripe is enabled for your venue:

| Option | When available | What it does | Booking status created |
|--------|---------------|--------------|----------------------|
| **Submit Enquiry** (blue button) | Always | Submits with no payment | `pending` |
| **Pay Deposit by Card** (green button) | Stripe enabled only | Collects deposit via Stripe Checkout (20% of estimated total, min £10 / max £500) | `pending_deposit` |

**Free enquiry path:**
1. Form submitted → booking request created in database
2. Customer sees a success panel: "Enquiry Submitted!" with a note about the 7-day window
3. Customer receives an acknowledgement email
4. Staff receive a notification email (see Section 7 for email configuration)
5. Enquiry appears in Dashboard → **Pending Requests**

**Stripe deposit path:**
1. Form submitted → booking request created → customer redirected to Stripe Checkout
2. Customer pays the deposit amount shown on the button
3. Customer lands on the **payment confirmation page** (checkout.html) showing "Payment Received" and their booking reference ID
4. Staff receive a notification email
5. Enquiry appears in Dashboard → **Pending Requests** (with `pending_deposit` status)

---

#### 7-day window

When a customer submits a free enquiry, the system automatically emails them a warning if **4 or more days pass** without a deposit being paid. After **7 days**, the enquiry expires and is automatically removed. See [Section 7 — Automatic Email Notifications](#7-automatic-email-notifications) for full detail on the expiry warning email.

---

#### The payment confirmation page (checkout.html)

After a successful Stripe payment, the customer lands on a branded confirmation page that shows:
- "Payment Received" heading with animated green tick
- The venue name (e.g. "Thank you for your booking at Main Street Hall")
- A Booking ID reference strip — the customer can quote this ID when contacting you
- A **Close Window** button (for public customers) or **Back to Dashboard** button (if a staff member is logged in)

---

#### What staff do after an enquiry comes in

1. Go to **Dashboard** → **Pending Requests** tab
2. Find the enquiry in the list (sorted by date, newest first)
3. Click the row to open the booking detail panel on the right
4. Review the details: customer, room, date, time, event type, guests, notes
5. Click **Confirm** to convert it to a confirmed booking (this triggers a confirmation email to the customer)
6. Or click **Decline** to remove the request

> No deposit collection is needed at this stage if the customer already paid via Stripe — the `pending_deposit` status tracks that a card payment is expected. Staff should confirm the booking once the Stripe payment is received (the webhook updates the status automatically).

---

## 2. Adding Customer Notes to a Booking or Customer Profile

Customer notes (called **Interactions**) let you record phone calls, emails, in-person conversations, and any other contact with a customer.

### Adding a note from the Customers page

1. Click **Customers** in the sidebar.
2. Find the customer using the **search bar** at the top (search by name, email, or phone).
3. **Click the customer's row** to open their profile modal.
4. The modal shows the customer's details, then their **Booking History** below.
5. **Click any booking row** in the Booking History table — this opens the **Log Interaction** panel for that booking.
6. Fill in the form:
   - **Subject** *(required)* – a short title for the note (e.g. "Payment follow-up call").
   - **Interaction Type** *(required)* – Phone Call, Email, In Person, SMS, WhatsApp, or Other.
   - **Notes** *(required)* – the full detail of what was discussed or agreed.
   - Date and staff member are recorded automatically from the current time and your login.
7. Click **Save Interaction**.

The note appears immediately in the **Customer Interactions** section below the booking history on that customer's profile, most recent first. It also appears in the global **Customer Interactions** tab on the dashboard.

---

### Adding a note from the Dashboard

1. On the **Dashboard**, go to the **Pending Requests** or **Upcoming Events** tab.
2. Click a booking row to open the booking detail panel on the right.
3. Scroll down to **Booking Interactions**.
4. Click **Log Note** (or **Log Interaction**) to open the same interaction form described above.
5. Fill in the details and click **Save Interaction**.

---

### Adding a note from the Bookings list

1. Click **Bookings** in the sidebar.
2. Find the booking in the list.
3. Click the booking card or the **Log Note** icon on the row.
4. The interaction form opens — fill in and save as above.

---

### Viewing past notes

- On the **Customers** page: open any customer's profile and scroll to **Customer Interactions** — all past notes for that customer are shown newest first.
- On the **Dashboard**: click the **Customer Interactions** filter tab to see a searchable, sortable table of all interactions across every customer. Click any row to open a full interaction detail view. Use the search box to filter by customer name, email, subject, type, staff member, or notes text.

---

## 3. Viewing Existing Bookings

There are three places to view bookings, each suited to different purposes.

---

### The Calendar (best for day-to-day view)

1. Click **Calendar** in the sidebar.
2. Use the **room filter** dropdown at the top left to show only a specific room (including specific partitions like "North Half"), or leave on **All Rooms**.
3. Switch between views using the toolbar buttons:
   - **Month** – full month grid with coloured booking chips. Best for a high-level overview.
   - **Week** – time-slotted week grid (07:00–23:00). Bookings appear as **full vertical blocks** spanning their exact start-to-end time — a 9:00–17:00 booking fills the 9am–5pm column space. Best for spotting gaps and overlaps across the week.
   - **Day** – single day version of the same time-slotted block view. Best for managing a busy day.
   - **List** – plain chronological list of upcoming events.
4. Use **← Today →** to navigate between months/weeks/days.
5. In **Week** and **Day** views, each booking block shows:
   - **Customer name** (bold, top of block)
   - **Room name** (coloured to match the room legend)
   - **Time range** (e.g. 09:00 – 17:00, pinned to the bottom of the block)
   - **Guest count** (if recorded, shown with a person icon)
   - A **purple line** moves in real time to show the current time of day.
6. **Click any booking block or chip** to open a detail popup showing customer name, room, times, payment status, and action buttons (Pay / Cancel).
7. **Colour legend** (bottom of filter bar):
   - Green = Available
   - Amber = Partial bookings
   - Indigo = Fully booked day

> **Tip:** Use **Week** or **Day** view when resolving scheduling queries — the block layout makes it immediately obvious whether a room is free in a specific time slot without having to click into individual bookings.

---

### The Bookings List (best for filtering and bulk views)

1. Click **Bookings** in the sidebar.
2. Use the **filter tabs** along the top to narrow the list:
   - **All Bookings** – shows everything.
   - **Payment Due** – bookings with an outstanding balance.
   - **Paid** – fully settled bookings.
   - **Completed** – past events.
   - **Cancelled** – cancelled bookings (shown with a strikethrough status badge).
   - **Recurring Series** – groups all recurring bookings by series.
3. Use the **search bar** to find a specific customer name, room, or date.
4. Click the **Clear** button to reset filters and search.
5. Each booking card shows: customer name, room, date/time, status badge, total amount, and action buttons (**Pay** / **Cancel**).

---

### The Dashboard (best for quick overview)

1. On the **Dashboard**, use the four tab buttons below the KPI cards:
   - **Pending Requests** – new enquiries awaiting confirmation.
   - **Upcoming Events** – confirmed future bookings.
   - **Customer Interactions** – searchable table of all staff notes and contact history across all customers. Click any row to see full interaction details.
   - **Customers** – searchable customer directory.
2. The **Outstanding Payments** panel (right side of dashboard) shows all bookings with a balance still owed.

---

## 4. Setting Up Recurring Payments for Regular Customers

Recurring bookings are for customers who hire a room on a regular schedule (e.g. a weekly dance class, a monthly board meeting).

---

### Creating a recurring booking

1. Click **Calendar** in the sidebar.
2. Click the date of the **first session**.
3. In the Quick Booking panel, fill in the customer and booking details as normal (see Section 1A).
4. Click the **"Recurring booking"** toggle button (it turns purple/active when enabled).
5. The **Recurring Options** section appears:
   - **Frequency** – choose: **Weekly**, **Fortnightly**, or **Monthly**.
   - **Days of the week** – tick the day tiles for which days apply (e.g. Mon + Wed for a twice-weekly class).
   - **End date** – set the date the series should finish (or leave open-ended if unsure).
   - **Per-session price** and agreed monthly/cycle fee are calculated from the room rate.
6. A **preview** at the bottom shows the list of dates that will be booked.
7. Click **Record Deposit** or **Full Payment** (or **Save as Pending**) to create the series.

The series appears in the **Bookings** list under the **Recurring Series** tab, and each session appears on the **Calendar**.

---

### Recording a recurring payment

Recurring customers typically pay monthly or per cycle. To record a payment:

1. Click **Recurring** in the sidebar.
2. Find the customer's series card (search by name or scroll the list).
3. Each card shows:
   - Series name and customer name
   - Frequency and schedule (e.g. "Weekly · Every Monday")
   - Session count and cancelled sessions
   - Monthly rate and per-session rate
   - **Payment status badge**: 🟢 Paid · 🟡 Due · 🔴 Overdue
4. If a payment is due, a **Record Payment** button appears on the card.
5. Click **Record Payment**.
6. In the payment modal:
   - **Amount** – auto-filled with the amount due; adjust if a partial payment.
   - **Payment Method** – Cash, Card, Bank Transfer, BACS, etc.
7. Click **Confirm Payment**.
8. The series card updates to **Paid** status and the payment appears in **Accounts**.

---

### Viewing recurring series sessions

1. In **Bookings**, click the **Recurring Series** filter tab.
2. Find the series card and click **Sessions** (chevron button) to expand the list of individual sessions.
3. Each session shows its own date, time, status, and action buttons (Pay / Cancel).

---

> **Note:** To adjust a recurring series (change price, end date, or room), this currently requires an admin to update the series record. Contact your system administrator.

---

## 5. Cancelling Bookings

> **Important:** Cancelling a booking is **permanent**. If Stripe payments are connected, cancellation may trigger a refund. Always confirm with the customer before cancelling.

---

### Cancelling a single booking from the Bookings list

1. Click **Bookings** in the sidebar.
2. Find the booking you want to cancel (use filters or search).
3. Click the red **Cancel** button on the booking card.
4. A confirmation dialog appears:
   > *"Are you sure you want to CANCEL the booking for [Customer Name]? This will refund payments and remove it from the calendar."*
5. Click **OK** to confirm. Click **Cancel** to abort.
6. The booking status changes to **Cancelled** (shown with a red strikethrough badge).

---

### Cancelling a booking from the Calendar

1. Click **Calendar** in the sidebar.
2. Click on the booking event on the calendar.
3. In the booking detail popup, click the **Cancel Booking** button (shown in red).
4. Confirm in the dialog that appears.

---

### Cancelling a single session within a recurring series

1. Click **Bookings** in the sidebar.
2. Click the **Recurring Series** filter tab.
3. Find the series and click **Sessions** to expand the session list.
4. Find the specific session and click its **Cancel** button.
5. Confirm in the dialog. Only that one session is cancelled — the rest of the series continues.

---

### Cancelling an entire recurring series

1. Click **Bookings → Recurring Series** tab.
2. Expand the series and cancel each remaining future session individually using the **Cancel** button.

> **Tip:** Cancelled sessions stay visible in the list with a strikethrough so you have a record of what was booked.

---

## 6. Divisible Spaces — Booking Room Partitions

Some venues divide a large space (e.g. **Main Hall**) into independent bookable sections — **halves**, **thirds**, or **quarters**. Each partition has its own rate, capacity, and operating hours, and can be booked independently of the other sections.

---

### How it works for staff

- The **Room** dropdown in any booking form lists both the full room and its sections. For example:
  - `Main Hall` — the full space
  - `Main Hall – North Half` — the left section (own rate, own calendar)
  - `Main Hall – South Half` — the right section
- Booking **Main Hall** for a date/time will be **rejected** if any partition (North Half, South Half) is already booked in that slot. The system prevents double-booking automatically.
- Booking **North Half** will be **rejected** if Main Hall is already booked — the full room occupies both halves.
- Booking **North Half** when **South Half** is booked is **allowed** — they are physically separate sections with no overlap.

---

### What the system checks automatically

You do not need to manage these rules manually. When you submit a booking the system checks:

| Scenario | Result |
|----------|--------|
| Booking a partition when the parent room is already booked | ❌ Rejected — conflict with parent |
| Booking a parent room when any partition is already booked | ❌ Rejected — conflict with child |
| Booking a partition when a spatially-overlapping partition is booked | ❌ Rejected — footprint overlap |
| Booking a partition when a non-overlapping sibling is booked | ✅ Allowed — separate physical areas |

> **Example:** Your venue divides Main Hall into 1st Third, 2nd Third, and 3rd Third. A dance class has booked the **2nd Third** (middle section) on Monday. Another group can still book the **1st Third** (front) or the **3rd Third** (back) on the same day — they do not physically overlap. However, no one can book **Main Hall** (the full room) or **2nd Third** again on that day.

---

### What you see on the calendar

When partitions are booked independently, each appears as its own colour-coded block on the Calendar. Use the **room filter** dropdown to view just one partition, just the parent room, or all rooms at once.

---

### Setting up room partitions (Admin / Manager only)

If you have **Admin** or **Manager** access, you can define partitions in **Admin Config → Rooms**:

1. Go to **Admin Config** → **Rooms** tab.
2. Create the parent room first (e.g. "Main Hall") with the full-room rate and capacity.
3. Click **Add Room** for the first partition (e.g. "Main Hall – North Half"):
   - Fill in **Room Name**, **Capacity**, **Hourly Rate** (its own rate).
   - Optionally set **Open Time / Close Time** if this partition has different operating hours from the parent.
   - Open the **Parent Room / Anchor Space** section.
   - Select the parent room from the **Parent Room** dropdown.
   - Choose **Divide Into**: Halves, Thirds, or Quarters.
   - Choose **Position**: 1st Half / 2nd Half (or 1st Third, 2nd Third, 3rd Third, etc.).
4. Repeat for each partition.

In the **Rooms** table, the parent room shows a "N partition(s)" badge, and each child room shows its parent name and position underneath its name.

---

## Recording a Manual Payment (Balance or Partial Payment)

When a customer pays a remaining balance by cash, card, or bank transfer:

1. Go to **Bookings** and find the booking (it will show a **Payment Due** or amber status badge).
2. Click the **Pay** button on the booking card.
3. The **Payment** modal opens showing:
   - Booking reference and customer name
   - Total booking value
   - Balance due
   - A **slider / amount field** to set the payment amount
4. Choose the **Payment Method**: Cash, Card, Bank Transfer, BACS, Cheque, Other.
5. If **Stripe is enabled** and you select **Card**: click **Generate Payment Link** to create a Stripe Checkout link you can send to the customer or open on a card reader.
6. Click **Confirm Payment**.
7. A receipt summary appears. Click **Done** to close.

The payment is recorded in **Accounts** and the booking status updates automatically.

---

## Troubleshooting

| Problem | Likely cause | What to do |
|---------|-------------|------------|
| **"Unavailable" / red availability bar** | Another booking already exists in that slot | Choose a different time or room. Check the **Calendar** to see the conflict. |
| **"Conflict with parent/child room"** | A partition or parent room is already booked in that slot | Choose the correct specific section or a different time. See Section 6. |
| **Guest count warning appears** | Guest number exceeds the room's capacity | Reduce the guest count or select a larger room. |
| **"Cannot create a booking in the past"** | The date entered is before today | Change the date to today or a future date. |
| **Booking duration exceeds limit** | Multi-day span is more than 90 days | Shorten the booking period or create two separate bookings. |
| **"This room does not open until HH:MM"** | The room has operating hours set that your chosen start time falls before | Change the start time to be within the room's operating hours, or choose a different room. |
| **"This room closes at HH:MM"** | Your chosen end time is after the room's closing time | Move the end time earlier or choose a different room. |
| **Page shows nothing / blank list** | Session may have expired | Refresh the page. If redirected to login, log back in and try again. |
| **"Something went wrong" toast** | API or network error | Wait a few seconds and click **Refresh** (top-right button on Dashboard). If it persists, contact your administrator. |
| **Customer not found in search** | Customer hasn't been added yet | Add them via the walk-in form or enquiry form — the system creates a customer record automatically. |
| **"Balance Due" still showing after payment** | Payment not yet saved | Ensure you clicked **Confirm Payment** in the payment modal, not just closed it. Check **Accounts** for the transaction. |
| **Calendar not loading** | Browser cache or connectivity issue | Hard-refresh the page (Ctrl+Shift+R on Windows / Cmd+Shift+R on Mac). Try an incognito/private window. |
| **Week/Day view shows no blocks** | Bookings exist but times weren't recorded | Bookings without a start/end time fall back to all-day events and appear at the very top of the time grid as a banner, not a block. Check the booking's recorded times. |
| **Booking block appears very short** | End time is close to start time | A 30-minute booking produces a small block — zoom in or switch to Day view for clarity. |
| **Logged out unexpectedly** | Session token expired (tokens last up to 1 hour) | Log back in. Your data is safe — nothing is lost. |
| **Recurring payment button missing** | No payment is currently due for this period | The **Record Payment** button only appears when a payment period is due or overdue. Check the series card's payment status badge. |

---

## Key Concepts Glossary

| Term | Meaning |
|------|---------|
| **Pending Request** | A booking enquiry submitted via the online form, not yet confirmed by staff |
| **Confirmed** | A booking that has been accepted and is on the calendar |
| **Deposit Paid** | A partial payment has been made; balance still owed |
| **Fully Paid** | No balance remaining |
| **Overridden** | A booking manually placed by staff that bypassed the normal clash check |
| **Interaction** | A logged note about contact with a customer (call, email, in-person, etc.) |
| **Recurring Series** | A set of regular bookings linked together (e.g. weekly class) |
| **BACS** | Bank Automated Clearing System – UK bank-to-bank payment method |
| **Outstanding balance** | Amount a customer still owes on a booking |
| **Tenant** | Your venue's isolated data space in the system |
| **Parent Room** | A large bookable space that is divided into smaller partitions (e.g. Main Hall) |
| **Partition / Child Room** | A bookable section of a parent room (e.g. North Half, 2nd Third, 3rd Quarter) |
| **Anchor Space** | Another name for a parent room — the full space that partitions are anchored to |
| **Room Operating Hours** | Optional open/close times set per room in Admin Config — bookings outside these hours are automatically rejected |
| **Clash / Conflict** | When two bookings would overlap in the same physical space — the system rejects the second booking automatically |

---

---

## 7. Automatic Email Notifications

VenueDesk sends automated emails to customers at key points in the booking journey. These emails are sent from **bookings@venuedesk.co.uk** and require no manual action from staff — they fire automatically.

---

### Emails customers receive

| When | Email subject | Colour |
|------|---------------|--------|
| Customer submits the online enquiry form | 📬 Enquiry Received — [Venue Name] | Indigo |
| Staff click **Confirm** on a pending request | ✅ Booking Confirmed — [Date] | Green |
| Deposit payment recorded (cash/card/BACS) | Deposit Payment Confirmed — [Date] | Indigo |
| Partial balance payment recorded | Payment Received — Remaining Balance: £X | Amber |
| Full balance settled | Balance Fully Settled — Booking Confirmed ✓ | Green |
| BACS payment method selected | Booking Reserved — Awaiting BACS Payment | Amber |
| Online card payment confirmed via Stripe | Card Payment Confirmed ✓ — [Date] | Green |
| Enquiry not confirmed after 4 days (no deposit) | ⏰ Action required: Your enquiry expires in X days | Amber |

---

### Enquiry received email

When a customer submits the **New Booking** enquiry form, they immediately receive a confirmation that their request was received. It includes:

- A summary of what they requested (space, date, time, event type, guests)
- A clear notice that their enquiry will **expire after 7 days** if no deposit is paid
- A contact button linking to `bookings@venuedesk.co.uk`
- Their enquiry reference number

At the same time, the **staff notification email address** receives a **staff alert email** with the customer's full contact details, their request summary, and a **Review in Dashboard** link. This address is configured in **Admin Config → Settings → Staff Notification Email** (see below).

---

### Booking confirmed email

When you click **Confirm** on a pending request from the Dashboard, the customer automatically receives a confirmation email containing:

- Date, time, room, event type, and guest count
- Total hire fee, deposit paid (with payment method), and any remaining balance
- A callout box if a balance is still owed
- Contact details for queries

> No manual email to the customer is needed — this fires automatically the moment you confirm the booking.

---

### Payment emails

Every time a payment is recorded (by you or automatically via Stripe), the customer receives a payment receipt. The email content varies by payment type:

- **Deposit** — indigo header, shows deposit amount paid and remaining balance
- **Partial balance** — amber header, shows amount paid and remaining balance
- **Full balance** — green header, "Fully Paid ✓" confirmation
- **BACS** — amber header with your venue's bank account details, sort code, and account number (so the customer can make the transfer), using the booking ID as the payment reference
- **Stripe card** — green header with the Stripe payment reference

---

### 7-day expiry warning email

The system runs a check every morning at **08:00**. Any customer who submitted an enquiry **4 or more days ago** without paying a deposit receives an expiry warning email. The email shows:

- How many days are remaining (e.g. "3 days remaining")
- The date their enquiry was submitted
- Clear consequences of not acting (enquiry will be permanently deleted)
- A contact button

Once the warning is sent, the system marks it so the same customer does not receive duplicate warnings. After **7 days** with no deposit, the enquiry is automatically removed.

> If a customer contacts you after receiving a warning email, use the Dashboard → Pending Requests tab to confirm their booking before the 7-day window expires.

---

### Setting your staff notification email address

The new-enquiry staff alert is sent to whichever email address is saved in **Admin Config → Settings**. To set or change it:

1. Log in to the dashboard and go to **Admin Config** in the sidebar.
2. Click the **Settings** tab.
3. Find the **Staff Notification Email** card at the top.
4. Enter the email address that should receive new enquiry alerts (e.g. `manager@yourvenue.co.uk`).
5. Click **Save Notification Email**.

The change takes effect immediately on the next enquiry submission — no restart required. If the field is left blank, alerts default to `bookings@venuedesk.co.uk`.

---

### What staff need to do

- **Nothing extra** — all emails fire automatically once the notification address is configured.
- If a customer says they didn't receive an email, ask them to **check their spam/junk folder** (especially Gmail, which may group emails).
- The **Audit Log** page records all booking and payment events with timestamps and staff names, which can help trace any email discrepancies.

---

## Troubleshooting — Email Issues

| Problem | Likely cause | What to do |
|---------|-------------|------------|
| **Customer says they got no confirmation email** | Email in spam; or their address was entered incorrectly | Ask them to check spam. Verify their email address in **Customers** page. |
| **Customer received duplicate expiry warning emails** | System test issue (rare) | Contact your administrator — this indicates a workflow was tested with a live email address. |
| **Staff alert email not arriving** | Notification address not configured or wrong address | Go to **Admin Config → Settings → Staff Notification Email**, verify the address is correct, and click Save. Changes take effect on the next enquiry. |
| **BACS email has no bank details** | Venue BACS details not set in Admin Config | Go to **Admin Config → Payments** tab and enter Sort Code, Account Number, and Account Name. |

---

## Troubleshooting — Booking & System Issues

| Problem | Likely cause | What to do |
|---------|-------------|------------|
| **"Unavailable" / red availability bar** | Another booking already exists in that slot | Choose a different time or room. Check the **Calendar** to see the conflict. |
| **"Conflict with parent/child room"** | A partition or parent room is already booked in that slot | Choose the correct specific section or a different time. See Section 6. |
| **Guest count warning appears** | Guest number exceeds the room's capacity | Reduce the guest count or select a larger room. |
| **"Cannot create a booking in the past"** | The date entered is before today | Change the date to today or a future date. |
| **Booking duration exceeds limit** | Multi-day span is more than 90 days | Shorten the booking period or create two separate bookings. |
| **"This room does not open until HH:MM"** | The room has operating hours set that your chosen start time falls before | Change the start time to be within the room's operating hours, or choose a different room. |
| **"This room closes at HH:MM"** | Your chosen end time is after the room's closing time | Move the end time earlier or choose a different room. |
| **Page shows nothing / blank list** | Session may have expired | Refresh the page. If redirected to login, log back in and try again. |
| **"Something went wrong" toast** | API or network error | Wait a few seconds and click **Refresh** (top-right button on Dashboard). If it persists, contact your administrator. |
| **Customer not found in search** | Customer hasn't been added yet | Add them via the walk-in form or enquiry form — the system creates a customer record automatically. |
| **"Balance Due" still showing after payment** | Payment not yet saved | Ensure you clicked **Confirm Payment** in the payment modal, not just closed it. Check **Accounts** for the transaction. |
| **Calendar not loading** | Browser cache or connectivity issue | Hard-refresh the page (Ctrl+Shift+R on Windows / Cmd+Shift+R on Mac). Try an incognito/private window. |
| **Logged out unexpectedly** | Session token expired (tokens last up to 1 hour) | Log back in. Your data is safe — nothing is lost. |
| **Recurring payment button missing** | No payment is currently due for this period | The **Record Payment** button only appears when a payment period is due or overdue. Check the series card's payment status badge. |

---

*For technical issues or system administration, contact your VenueDesk administrator.*
