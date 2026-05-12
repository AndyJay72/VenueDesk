# VenueDesk AI Lead Generator — User Guide

A complete reference for setting up, configuring and using the AI lead generator workflow and dashboard.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [What's Already Set Up](#whats-already-set-up)
4. [What You Need to Configure](#what-you-need-to-configure)
5. [Using the Dashboard](#using-the-dashboard)
6. [The AI Workflow — Step by Step](#the-ai-workflow--step-by-step)
7. [Adding Leads](#adding-leads)
8. [Lead Statuses Explained](#lead-statuses-explained)
9. [AI Scoring](#ai-scoring)
10. [Email Templates](#email-templates)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The VenueDesk AI Lead Generator is a fully automated outreach system that:

- Stores venue leads in a Postgres database
- Uses GPT-4o-mini to analyse each venue's website and write a personalised outreach email
- Automatically sends emails via SMTP, logs activity, and schedules follow-ups
- Displays everything through a live dashboard (`leadgen-dashboard.html`)

---

## System Architecture

```
leadgen-dashboard.html
        │
        │  REST calls (fetch)
        ▼
n8n Webhook APIs ──────────────────────────────────────────────
  GET  /webhook/leads-get           ← fetch all leads
  POST /webhook/leads-add           ← add a new lead
  POST /webhook/leads-update        ← update lead status
  GET  /webhook/leads-activity      ← fetch activity feed
  POST /webhook/leads-send-email    ← trigger AI email to a lead
        │
        ▼
Postgres Database (myadmin_db)
  ├── leads             ← all lead records
  └── lead_activity     ← email sent / reply / converted log
        │
        ▼
VenueDesk — AI Lead Generator (Daily)   ← scheduled workflow
  Schedule Trigger (09:00 daily)
    ├── Fetch New Leads (Postgres)
    ├── Fetch Website (HTTP)
    ├── AI Venue Analysis (OpenAI GPT-4o-mini)
    ├── AI Email Generator (OpenAI GPT-4o-mini)
    ├── Send Email (SMTP)
    ├── Mark as Contacted (Postgres)
    ├── Log Activity (Postgres)
    └── Follow-up Branch (for leads contacted > 4 days ago, no reply)
         ├── AI Follow-up Generator (OpenAI)
         ├── Send Follow-up (SMTP)
         └── Update Follow-up Count (Postgres)
```

---

## What's Already Set Up

The following are **deployed and active** in your n8n instance at `https://n8n.srv1090894.hstgr.cloud`:

| Workflow | Status | Notes |
|---|---|---|
| VenueDesk — Create Leads Table | Active | One-off init, already run |
| VenueDesk — API: Get Leads | **Live** | Dashboard reads from this |
| VenueDesk — API: Add Lead | **Live** | Dashboard add-lead button |
| VenueDesk — API: Update Lead Status | **Live** | Status change actions |
| VenueDesk — API: Get Activity | **Live** | Activity feed panel |
| VenueDesk — API: Send Email to Lead | **Live** | Manual send button |
| VenueDesk — AI Lead Generator (Daily) | **Inactive ⏸** | Needs credentials — see below |

The `leads` and `lead_activity` database tables are already created in your `myadmin_db` Postgres database (separate from the VenueDesk `bookings` database).

---

## What You Need to Configure

### Step 1 — Verify the SMTP "From" Address

The SMTP credential in n8n (`SMTP account`, id: `oWx6QKxXljDdeSDP`) is already bound to the email workflows. You need to confirm the **From email address** matches your actual SMTP account.

1. Go to `https://n8n.srv1090894.hstgr.cloud`
2. Open **VenueDesk — AI Lead Generator (Daily)**
3. Click the **"Send Email"** node
4. Change the `From Email` field from `hello@venuedesk.co.uk` to your actual sending address
5. Do the same for the **"Send Follow-up"** node
6. Save the workflow

> **Note:** If you don't have a dedicated sending domain yet, you can use your Gmail/Outlook address — just make sure the SMTP credential is configured accordingly.

### Step 2 — Activate the Daily Workflow

Once the From address is correct:

1. Open **VenueDesk — AI Lead Generator (Daily)**
2. Click the toggle in the top-right to **Activate**
3. The workflow will now run every day at 09:00

> The workflow will only send emails to leads with status `new` (up to 20 per run), so it won't spam anyone.

### Step 3 — Add Your First Real Leads

See [Adding Leads](#adding-leads) below.

---

## Using the Dashboard

Open `leadgen-dashboard.html` in your browser (or serve it from the VenueDesk folder).

### Stats Bar

| Stat | What it shows |
|---|---|
| Total Leads | All leads in the database |
| Emails Sent | Leads in `contacted`, `replied`, `follow_up`, or `converted` status |
| Replies | Leads in `replied` or `converted` status |
| Converted | Leads who booked a demo or signed up |

### Pipeline

Shows a count at each funnel stage: **New → Contacted → Replied → Follow-up → Converted**

### Lead Table

- **Search** by venue name or email
- **Filter** by status or venue type
- Hover a row to reveal action buttons:
  - **Envelope** — sends an AI-generated email immediately via the n8n workflow
  - **Tick** — marks the lead as Converted
  - **Bin** — removes the lead

### Activity Feed

Real-time log of all workflow actions — emails sent, replies received, leads added, conversions.

### Add Lead Button

Opens the **Add Lead** modal. Fill in:
- Venue Name *(required)*
- Venue Type *(required)*
- Email *(required)*
- Contact Name, Phone, Website *(optional but improve AI personalisation)*
- Notes *(optional)*

Once saved, the lead appears with status `new` and will be picked up by the next daily workflow run (or you can send immediately using the envelope button).

---

## The AI Workflow — Step by Step

When the **daily workflow** runs (or you trigger a manual send), this is what happens for each `new` lead:

### 1. Fetch New Leads
Queries the `leads` table for up to 20 records with `status = 'new'` and a valid email address.

### 2. Fetch Website
The workflow makes a GET request to the lead's `website_url`. This gives the AI real content to personalise the email with.

> If there is no website URL, the AI still generates an email based on the venue name and type alone.

### 3. AI Venue Analysis
GPT-4o-mini analyses the website content and returns a JSON score card:

```json
{
  "score": 8,
  "venue_type": "village_hall",
  "key_feature": "hosts weekly community events and private hire",
  "pain_point": "likely managing bookings by phone or simple spreadsheet",
  "friendly_name": "the team at Thornfield",
  "tone": "friendly"
}
```

This score (1–10) is saved to the lead record as the **AI Score**.

### 4. AI Email Generator
A second GPT-4o-mini call writes a personalised 3–4 paragraph outreach email using the analysis above. The email is:

- Warm and non-pushy
- References something specific about the venue
- Signs off as "The VenueDesk Team"
- Kept to plain text (no HTML)

### 5. Send Email
The email is sent via your SMTP account to the lead's email address.

### 6. Mark as Contacted
The lead's status is updated to `contacted`, and `last_email_sent_at` is set to now.

### 7. Log Activity
An entry is added to the `lead_activity` table — visible in the dashboard activity feed.

---

### Follow-up Branch

Runs in parallel for any lead where:
- Status is `contacted`
- `reply_received` is `false`
- `last_email_sent_at` was more than **4 days ago**
- `follow_up_count` is less than **2**

A fresh AI follow-up email is generated referencing the original contact. The `follow_up_count` counter increments, and if it reaches 1, the status moves to `follow_up`.

After 2 follow-ups with no reply, the lead is left alone.

---

## Adding Leads

### Via the Dashboard
Use the **+ Add Lead** button. Leads added here go straight into the database with status `new`.

### Via Spreadsheet / Bulk Import
To import many leads at once, you can insert directly into the `leads` table:

```sql
INSERT INTO leads (venue_name, venue_type, contact_name, email, phone, website_url, notes, status)
VALUES
  ('Ashford Village Hall', 'village_hall', 'Janet Brooks', 'info@ashfordvh.co.uk', '01234 111222', 'https://ashfordvh.co.uk', '', 'new'),
  ('Northgate Sports Club', 'sports_club', 'Marcus Kelly', 'admin@northgatefc.co.uk', '', '', '', 'new');
```

Accepted `venue_type` values:

| Value | Label |
|---|---|
| `village_hall` | Village Hall |
| `sports_club` | Sports Club |
| `event_venue` | Event Venue |
| `hotel` | Hotel |
| `community_centre` | Community Centre |

### Good Sources for Leads

- Google Maps search: *"village hall hire [county]"*
- ACRE (Action with Communities in Rural England) directory
- Sport England club finder
- Local council venue listings
- Facebook groups for community venues

---

## Lead Statuses Explained

| Status | Meaning |
|---|---|
| `new` | Just added, no contact made yet |
| `contacted` | Initial email sent by the AI workflow |
| `replied` | They replied to your email |
| `follow_up` | Second follow-up email sent |
| `converted` | Booked a demo / signed up for VenueDesk |
| `bounced` | Email address invalid / delivery failed |
| `unsubscribed` | Asked to be removed — do not contact again |

You can update the status manually from the dashboard action buttons, or the workflow updates it automatically as emails are sent.

> **Important:** If someone asks to be removed from your list, set their status to `unsubscribed` immediately. The workflow filters out all non-`new` leads so they will never be re-contacted.

---

## AI Scoring

Each lead is scored **1–10** by GPT-4o-mini based on how likely they are to need booking software:

| Score | Meaning |
|---|---|
| 8–10 | High priority — active venue, clear booking need |
| 5–7 | Medium priority — some potential |
| 1–4 | Low priority — may already have software or unlikely to convert |

Scores are shown as a coloured bar in the lead table:
- **Green** = 8–10
- **Amber** = 5–7
- **Red** = 1–4

Scores are only assigned after the workflow has processed a lead. New manually-added leads show `—` until the next workflow run.

---

## Email Templates

The AI generates emails dynamically — you don't need to manage templates. However, the prompts can be edited directly in n8n if you want to adjust the tone, length or sign-off.

To edit the prompt:

1. Open n8n → **VenueDesk — AI Lead Generator (Daily)**
2. Click the **"AI Email Generator"** node
3. Edit the `content` field in the Messages section
4. Save

The current prompt instructs the AI to:
- Keep it to 3–4 short paragraphs
- Be warm, not salesy
- Reference the venue specifically
- Sign off as "The VenueDesk Team"

---

## Troubleshooting

### Dashboard shows demo data instead of real leads
The dashboard falls back to demo data when the API call fails. Check:
- The n8n workflows are **Active** (not just saved)
- The **Get Leads** webhook `GET /webhook/leads-get` returns a 200 response
- Test the endpoint: open `https://n8n.srv1090894.hstgr.cloud/webhook/leads-get` in your browser

### Emails are not being sent
1. Check the workflow is **Activated**
2. Check the SMTP credential is valid — go to n8n → Credentials → **SMTP account** and click **Test**
3. Check the `From Email` field matches your actual SMTP sending address
4. Check n8n execution history for error messages: n8n → Executions

### AI emails are blank or malformed
This usually means the OpenAI API returned unexpected JSON. The workflow has a fallback `Parse Email JSON` code node that handles this, but if OpenAI is down or the API key has expired:
1. Go to n8n → Credentials → **OpenAi account 2**
2. Verify the API key is still valid at platform.openai.com
3. Check your OpenAI usage quota hasn't been exceeded

### "No new leads" — workflow runs but sends nothing
This is expected if all leads have already been contacted. Add new leads via the dashboard, or check the database:
```sql
SELECT count(*) FROM leads WHERE status = 'new';
```

### A lead was contacted twice
The workflow uses `status = 'new'` as the filter — once a lead is marked `contacted`, they won't be emailed again (except the follow-up branch). If a duplicate was sent, it's likely the lead was manually reset to `new` status.

---

## Quick Reference

| Action | How |
|---|---|
| Add a lead | Dashboard → **+ Add Lead** button |
| Send email now | Lead row → hover → envelope icon |
| Mark as converted | Lead row → hover → tick icon |
| View email history | Activity Feed panel |
| Change workflow schedule | n8n → AI Lead Generator → Schedule node |
| Edit email tone/length | n8n → AI Email Generator node → Messages |
| Check for errors | n8n → Executions tab |
| Bulk import leads | Direct SQL INSERT into `leads` table |

---

*VenueDesk AI Lead Generator · Built with n8n, OpenAI GPT-4o-mini and Postgres*
