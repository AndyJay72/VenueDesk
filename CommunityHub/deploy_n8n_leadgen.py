#!/usr/bin/env python3
"""
VenueDesk AI Lead Generator — n8n Workflow Deployer
Creates the leads table and deploys all n8n workflows via API.
"""

import json, requests, sys, time

N8N_BASE   = "https://n8n.srv1090894.hstgr.cloud"
API_KEY    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMjQ4NTI3NC03MDk3LTRlYjUtODUwMi1lMzliMjMwODA5NmMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNGZmYmRmMzMtMjdmYi00M2EyLWI4ZjItMTI5YzA4YTcyYjJhIiwiaWF0IjoxNzcyMjc5NjY3LCJleHAiOjE3NzQ4NDMyMDB9.pxZSPNnmNHdZ3n-Oo4EfqR8YyLwDOMl0Apb0hbOVdeQ"
PG_CRED_ID     = "iEsRYyB7vjr5G7i8"   # Postgres account 3 (myadmin_db)
OPENAI_CRED_ID = "sAiUxZnK5nm6DZfX"   # OpenAi account 2
SMTP_CRED_ID   = "oWx6QKxXljDdeSDP"   # SMTP account

HEADERS = {
    "X-N8N-API-KEY": API_KEY,
    "Content-Type": "application/json",
}

def api(method, path, body=None):
    url = f"{N8N_BASE}/api/v1{path}"
    r = getattr(requests, method)(url, headers=HEADERS, json=body, timeout=30)
    if r.status_code >= 400:
        print(f"  ✗ {method.upper()} {path} → {r.status_code}: {r.text[:300]}")
        return None
    return r.json()

def create_workflow(wf):
    wf.setdefault("settings", {"executionOrder": "v1"})
    should_activate = wf.pop("active", False)
    result = api("post", "/workflows", wf)
    if result:
        wf_id = result.get("id")
        if should_activate:
            api("post", f"/workflows/{wf_id}/activate", {})
        status = "active" if should_activate else "inactive"
        print(f"  ✓ Created ({status}): {wf['name']}  (id={wf_id})")
        return wf_id
    return None

def pg_cred():
    return {"postgres": {"id": PG_CRED_ID, "name": "Postgres account 3"}}

def openai_cred():
    return {"openAiApi": {"id": OPENAI_CRED_ID, "name": "OpenAi account 2"}}

def smtp_cred():
    return {"smtp": {"id": SMTP_CRED_ID, "name": "SMTP account"}}

# ─── Workflow: Create leads table (webhook-triggered) ─────────────────────
def wf_create_table():
    return {
        "name": "VenueDesk — Create Leads Table",
        "active": True,
        "nodes": [
            {
                "id": "trigger1",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-init",
                    "httpMethod": "GET",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-init"
            },
            {
                "id": "pg_create",
                "name": "Create leads table",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [420, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "CREATE TABLE IF NOT EXISTS leads (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), venue_name TEXT NOT NULL, venue_type TEXT, contact_name TEXT, email TEXT, phone TEXT, website_url TEXT, status TEXT NOT NULL DEFAULT 'new', ai_score INTEGER, ai_analysis TEXT, ai_email_body TEXT, email_subject TEXT, notes TEXT, follow_up_count INTEGER DEFAULT 0, reply_received BOOLEAN DEFAULT FALSE, last_email_sent_at TIMESTAMPTZ, last_reply_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE IF NOT EXISTS lead_activity (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID REFERENCES leads(id) ON DELETE SET NULL, type TEXT, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW()); SELECT 'tables_ready' AS status"
                }
            },
            {
                "id": "resp_init",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [660, 300],
                "parameters": {
                    "respondWith": "json",
                    "responseBody": "={{ {success: true, message: 'Leads tables created (or already existed)'} }}"
                }
            }
        ],
        "connections": {
            "Webhook":            {"main": [[{"node": "Create leads table", "type": "main", "index": 0}]]},
            "Create leads table": {"main": [[{"node": "Respond",           "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: leads-get (GET /webhook/leads-get) ──────────────────────────
def wf_leads_get():
    return {
        "name": "VenueDesk — API: Get Leads",
        "active": True,
        "nodes": [
            {
                "id": "wh1",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-get",
                    "httpMethod": "GET",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-get"
            },
            {
                "id": "pg1",
                "name": "Get All Leads",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [440, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "SELECT * FROM leads ORDER BY created_at DESC LIMIT 500"
                }
            },
            {
                "id": "resp1",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [680, 300],
                "parameters": {
                    "respondWith": "allIncomingItems",
                    "options": {}
                }
            }
        ],
        "connections": {
            "Webhook":       {"main": [[{"node": "Get All Leads", "type": "main", "index": 0}]]},
            "Get All Leads": {"main": [[{"node": "Respond",       "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: leads-add (POST /webhook/leads-add) ─────────────────────────
def wf_leads_add():
    return {
        "name": "VenueDesk — API: Add Lead",
        "active": True,
        "nodes": [
            {
                "id": "wh2",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-add",
                    "httpMethod": "POST",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-add"
            },
            {
                "id": "pg2",
                "name": "Insert Lead",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [440, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": """
INSERT INTO leads (venue_name, venue_type, contact_name, email, phone, website_url, notes, status)
VALUES (
  '{{ $json.body.venue_name }}',
  '{{ $json.body.venue_type }}',
  '{{ $json.body.contact_name }}',
  '{{ $json.body.email }}',
  '{{ $json.body.phone }}',
  '{{ $json.body.website_url }}',
  '{{ $json.body.notes }}',
  'new'
) RETURNING *
                    """.strip()
                }
            },
            {
                "id": "act2",
                "name": "Log Activity",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [680, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "INSERT INTO lead_activity (lead_id, type, message) VALUES ('{{ $json.id }}', 'lead_added', 'Lead added: {{ $json.venue_name }}')"
                }
            },
            {
                "id": "resp2",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [920, 300],
                "parameters": {
                    "respondWith": "json",
                    "responseBody": "={{ {success: true, message: 'Lead added', id: $('Insert Lead').first().json.id} }}"
                }
            }
        ],
        "connections": {
            "Webhook":      {"main": [[{"node": "Insert Lead",   "type": "main", "index": 0}]]},
            "Insert Lead":  {"main": [[{"node": "Log Activity",  "type": "main", "index": 0}]]},
            "Log Activity": {"main": [[{"node": "Respond",       "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: leads-update (POST /webhook/leads-update) ───────────────────
def wf_leads_update():
    return {
        "name": "VenueDesk — API: Update Lead Status",
        "active": True,
        "nodes": [
            {
                "id": "wh3",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-update",
                    "httpMethod": "POST",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-update"
            },
            {
                "id": "pg3",
                "name": "Update Status",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [440, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "UPDATE leads SET status='{{ $json.body.status }}' WHERE id='{{ $json.body.id }}' RETURNING *"
                }
            },
            {
                "id": "act3",
                "name": "Log Activity",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [680, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "INSERT INTO lead_activity (lead_id, type, message) VALUES ('{{ $json.id }}', 'status_update', 'Status changed to {{ $json.status }} for {{ $json.venue_name }}')"
                }
            },
            {
                "id": "resp3",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [920, 300],
                "parameters": {
                    "respondWith": "json",
                    "responseBody": "={{ {success: true, updated: $('Update Status').first().json} }}"
                }
            }
        ],
        "connections": {
            "Webhook":       {"main": [[{"node": "Update Status", "type": "main", "index": 0}]]},
            "Update Status": {"main": [[{"node": "Log Activity",  "type": "main", "index": 0}]]},
            "Log Activity":  {"main": [[{"node": "Respond",       "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: leads-activity (GET /webhook/leads-activity) ────────────────
def wf_leads_activity():
    return {
        "name": "VenueDesk — API: Get Activity",
        "active": True,
        "nodes": [
            {
                "id": "wh4",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-activity",
                    "httpMethod": "GET",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-activity"
            },
            {
                "id": "pg4",
                "name": "Get Activity",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [440, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "SELECT a.*, l.venue_name FROM lead_activity a LEFT JOIN leads l ON l.id = a.lead_id ORDER BY a.created_at DESC LIMIT 50"
                }
            },
            {
                "id": "resp4",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [680, 300],
                "parameters": {
                    "respondWith": "allIncomingItems",
                    "options": {}
                }
            }
        ],
        "connections": {
            "Webhook":     {"main": [[{"node": "Get Activity", "type": "main", "index": 0}]]},
            "Get Activity":{"main": [[{"node": "Respond",      "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: Main AI Lead Generator (Scheduled daily) ────────────────────
def wf_ai_lead_gen():
    return {
        "name": "VenueDesk — AI Lead Generator (Daily)",
        "active": False,   # Enable after configuring OpenAI + email credentials
        "nodes": [
            # 1. Schedule — runs daily at 9am
            {
                "id": "schedule1",
                "name": "Daily at 9am",
                "type": "n8n-nodes-base.scheduleTrigger",
                "typeVersion": 1,
                "position": [100, 300],
                "parameters": {
                    "rule": {
                        "interval": [{"field": "hours", "hoursInterval": 24}]
                    }
                }
            },
            # 2. Fetch new leads from Postgres
            {
                "id": "pg_fetch",
                "name": "Fetch New Leads",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [340, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": """
SELECT * FROM leads
WHERE status = 'new'
  AND email IS NOT NULL
  AND email <> ''
ORDER BY created_at ASC
LIMIT 20
                    """.strip()
                }
            },
            # 3. Check if any leads found
            {
                "id": "if_leads",
                "name": "Any leads?",
                "type": "n8n-nodes-base.if",
                "typeVersion": 2,
                "position": [580, 300],
                "parameters": {
                    "conditions": {
                        "options": {"version": 2},
                        "conditions": [
                            {
                                "id": "c1",
                                "leftValue": "={{ $items().length }}",
                                "rightValue": 0,
                                "operator": {"type": "number", "operation": "gt"}
                            }
                        ]
                    }
                }
            },
            # 4. Try to fetch venue website
            {
                "id": "http_fetch",
                "name": "Fetch Website",
                "type": "n8n-nodes-base.httpRequest",
                "typeVersion": 4,
                "position": [820, 200],
                "parameters": {
                    "method": "GET",
                    "url": "={{ $json.website_url || 'https://example.com' }}",
                    "options": {
                        "timeout": 8000,
                        "redirect": {"redirect": {"followRedirects": True, "maxRedirects": 3}},
                        "response": {"response": {"neverError": True}}
                    }
                }
            },
            # 5. AI Venue Analysis — scores the lead and extracts key info
            {
                "id": "ai_analysis",
                "name": "AI Venue Analysis",
                "type": "@n8n/n8n-nodes-langchain.openAi",
                "typeVersion": 1,
                "position": [1060, 200],
                "credentials": openai_cred(),
                "parameters": {
                    "operation": "message",
                    "modelId": "gpt-4o-mini",
                    "messages": {
                        "values": [
                            {
                                "content": """You are a venue intelligence analyst for VenueDesk, a room booking CRM.

Analyse this venue and respond with ONLY valid JSON in this exact format:
{
  "score": <integer 1-10, how likely they need booking software>,
  "venue_type": "<village_hall|sports_club|event_venue|hotel|community_centre>",
  "key_feature": "<one sentence about what makes this venue special>",
  "pain_point": "<one sentence about the booking/admin challenge they likely face>",
  "friendly_name": "<how to address them, e.g. 'the team at Thornfield'>",
  "tone": "<formal|friendly|casual>"
}

Venue name: {{ $('Fetch New Leads').item.json.venue_name }}
Venue type: {{ $('Fetch New Leads').item.json.venue_type }}
Website content (first 2000 chars): {{ $json.data ? String($json.data).substring(0, 2000) : 'No website available' }}"""
                            }
                        ]
                    },
                    "options": {"temperature": 0.3}
                }
            },
            # 6. AI Email Generator
            {
                "id": "ai_email",
                "name": "AI Email Generator",
                "type": "@n8n/n8n-nodes-langchain.openAi",
                "typeVersion": 1,
                "position": [1300, 200],
                "credentials": openai_cred(),
                "parameters": {
                    "operation": "message",
                    "modelId": "gpt-4o-mini",
                    "messages": {
                        "values": [
                            {
                                "content": """You are writing a warm, non-pushy outreach email for VenueDesk — a simple room booking CRM designed for community venues.

Do NOT be salesy. Be helpful, conversational and brief. 3-4 short paragraphs maximum.

Write a personalised email to this venue. Respond with ONLY valid JSON:
{
  "subject": "<compelling email subject line>",
  "body": "<full email body in plain text, use \\n for line breaks>"
}

Venue name: {{ $('Fetch New Leads').item.json.venue_name }}
Contact name: {{ $('Fetch New Leads').item.json.contact_name || 'there' }}
Analysis: {{ $json.message.content }}

Sign off as: The VenueDesk Team
Website: venuedesk.co.uk"""
                            }
                        ]
                    },
                    "options": {"temperature": 0.7}
                }
            },
            # 7. Parse AI email JSON
            {
                "id": "parse_email",
                "name": "Parse Email JSON",
                "type": "n8n-nodes-base.code",
                "typeVersion": 2,
                "position": [1540, 200],
                "parameters": {
                    "jsCode": """
const lead = $('Fetch New Leads').item.json;
const aiRaw = $('AI Email Generator').item.json.message.content;
const analysisRaw = $('AI Venue Analysis').item.json.message.content;

let emailData = { subject: 'Booking software for ' + lead.venue_name, body: '' };
let analysisData = { score: 5 };

try { emailData = JSON.parse(aiRaw.replace(/^```json\\n?|```$/g, '')); } catch(e) {}
try { analysisData = JSON.parse(analysisRaw.replace(/^```json\\n?|```$/g, '')); } catch(e) {}

return [{
  json: {
    ...lead,
    email_subject: emailData.subject,
    email_body: emailData.body,
    ai_score: analysisData.score || 5,
    ai_analysis: analysisRaw
  }
}];
"""
                }
            },
            # 8. Send Email (SMTP — configure credentials in n8n UI)
            {
                "id": "send_email",
                "name": "Send Email",
                "type": "n8n-nodes-base.emailSend",
                "typeVersion": 2,
                "position": [1780, 200],
                "credentials": smtp_cred(),
                "parameters": {
                    "fromEmail": "hello@venuedesk.co.uk",
                    "toEmail": "={{ $json.email }}",
                    "subject": "={{ $json.email_subject }}",
                    "emailType": "text",
                    "text": "={{ $json.email_body }}",
                    "options": {}
                }
            },
            # 9. Update lead status in Postgres
            {
                "id": "pg_update",
                "name": "Mark as Contacted",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [2020, 200],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": """
UPDATE leads SET
  status = 'contacted',
  ai_score = {{ $json.ai_score }},
  ai_analysis = '{{ $json.ai_analysis.replace("'", "''") }}',
  email_subject = '{{ $json.email_subject.replace("'", "''") }}',
  ai_email_body = '{{ $json.email_body.substring(0, 2000).replace("'", "''") }}',
  last_email_sent_at = NOW()
WHERE id = '{{ $json.id }}'
                    """.strip()
                }
            },
            # 10. Log activity
            {
                "id": "pg_log",
                "name": "Log Email Sent",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [2260, 200],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "INSERT INTO lead_activity (lead_id, type, message) VALUES ('{{ $json.id }}', 'email_sent', 'AI email sent to {{ $json.venue_name }} — subject: {{ $json.email_subject }}')"
                }
            },
            # 11. No leads — end gracefully
            {
                "id": "no_leads",
                "name": "No New Leads",
                "type": "n8n-nodes-base.noOp",
                "typeVersion": 1,
                "position": [820, 460],
                "parameters": {}
            },
            # ── FOLLOW-UP BRANCH (separate loop runs for 'contacted' leads) ──
            # 12. Fetch leads due for follow-up (contacted > 4 days ago, no reply)
            {
                "id": "pg_followup",
                "name": "Fetch Follow-up Leads",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [340, 560],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": """
SELECT * FROM leads
WHERE status = 'contacted'
  AND reply_received = FALSE
  AND last_email_sent_at < NOW() - INTERVAL '4 days'
  AND follow_up_count < 2
  AND email IS NOT NULL
ORDER BY last_email_sent_at ASC
LIMIT 10
                    """.strip()
                }
            },
            # 13. AI Follow-up Generator
            {
                "id": "ai_followup",
                "name": "AI Follow-up Generator",
                "type": "@n8n/n8n-nodes-langchain.openAi",
                "typeVersion": 1,
                "position": [580, 560],
                "credentials": openai_cred(),
                "parameters": {
                    "operation": "message",
                    "modelId": "gpt-4o-mini",
                    "messages": {
                        "values": [
                            {
                                "content": """Write a brief, friendly follow-up email for VenueDesk. Keep it to 2 short paragraphs. Do NOT be pushy.
Reference that you sent them something recently. Offer to hop on a quick call or answer questions.

Respond with ONLY valid JSON:
{
  "subject": "<subject for follow-up>",
  "body": "<email body>"
}

Venue: {{ $json.venue_name }}
Original email subject: {{ $json.email_subject || 'our previous email' }}
Days since last contact: {{ Math.floor((Date.now() - new Date($json.last_email_sent_at).getTime()) / 86400000) }}
Follow-up number: {{ ($json.follow_up_count || 0) + 1 }}

Sign off as: The VenueDesk Team"""
                            }
                        ]
                    },
                    "options": {"temperature": 0.7}
                }
            },
            # 14. Send follow-up
            {
                "id": "send_followup",
                "name": "Send Follow-up",
                "type": "n8n-nodes-base.emailSend",
                "typeVersion": 2,
                "position": [820, 560],
                "credentials": smtp_cred(),
                "parameters": {
                    "fromEmail": "hello@venuedesk.co.uk",
                    "toEmail": "={{ $json.email }}",
                    "subject": "={{ JSON.parse($('AI Follow-up Generator').item.json.message.content).subject }}",
                    "emailType": "text",
                    "text": "={{ JSON.parse($('AI Follow-up Generator').item.json.message.content).body }}",
                    "options": {}
                }
            },
            # 15. Update follow-up count
            {
                "id": "pg_fu_update",
                "name": "Update Follow-up Count",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [1060, 560],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": """
UPDATE leads SET
  follow_up_count = follow_up_count + 1,
  last_email_sent_at = NOW(),
  status = CASE WHEN follow_up_count >= 1 THEN 'follow_up' ELSE status END
WHERE id = '{{ $json.id }}'
                    """.strip()
                }
            },
            # 16. Log follow-up
            {
                "id": "pg_fu_log",
                "name": "Log Follow-up",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [1300, 560],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "INSERT INTO lead_activity (lead_id, type, message) VALUES ('{{ $json.id }}', 'email_sent', 'Follow-up #{{ ($json.follow_up_count||0)+1 }} sent to {{ $json.venue_name }}')"
                }
            }
        ],
        "connections": {
            "Daily at 9am":           {"main": [[{"node": "Fetch New Leads",      "type": "main", "index": 0},
                                                  {"node": "Fetch Follow-up Leads","type": "main", "index": 0}]]},
            "Fetch New Leads":         {"main": [[{"node": "Any leads?",           "type": "main", "index": 0}]]},
            "Any leads?": {
                "main": [
                    [{"node": "Fetch Website",  "type": "main", "index": 0}],
                    [{"node": "No New Leads",   "type": "main", "index": 0}]
                ]
            },
            "Fetch Website":           {"main": [[{"node": "AI Venue Analysis",   "type": "main", "index": 0}]]},
            "AI Venue Analysis":       {"main": [[{"node": "AI Email Generator",  "type": "main", "index": 0}]]},
            "AI Email Generator":      {"main": [[{"node": "Parse Email JSON",    "type": "main", "index": 0}]]},
            "Parse Email JSON":        {"main": [[{"node": "Send Email",          "type": "main", "index": 0}]]},
            "Send Email":              {"main": [[{"node": "Mark as Contacted",   "type": "main", "index": 0}]]},
            "Mark as Contacted":       {"main": [[{"node": "Log Email Sent",      "type": "main", "index": 0}]]},
            "Fetch Follow-up Leads":   {"main": [[{"node": "AI Follow-up Generator","type": "main", "index": 0}]]},
            "AI Follow-up Generator":  {"main": [[{"node": "Send Follow-up",      "type": "main", "index": 0}]]},
            "Send Follow-up":          {"main": [[{"node": "Update Follow-up Count","type": "main", "index": 0}]]},
            "Update Follow-up Count":  {"main": [[{"node": "Log Follow-up",       "type": "main", "index": 0}]]}
        }
    }

# ─── Workflow: Manual send email webhook ──────────────────────────────────
def wf_send_email_webhook():
    return {
        "name": "VenueDesk — API: Send Email to Lead",
        "active": True,
        "nodes": [
            {
                "id": "wh5",
                "name": "Webhook",
                "type": "n8n-nodes-base.webhook",
                "typeVersion": 2,
                "position": [200, 300],
                "parameters": {
                    "path": "leads-send-email",
                    "httpMethod": "POST",
                    "responseMode": "responseNode"
                },
                "webhookId": "leads-send-email"
            },
            {
                "id": "pg5",
                "name": "Get Lead",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [440, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "SELECT * FROM leads WHERE id='{{ $json.body.id }}' LIMIT 1"
                }
            },
            {
                "id": "ai5",
                "name": "Generate Email",
                "type": "@n8n/n8n-nodes-langchain.openAi",
                "typeVersion": 1,
                "position": [680, 300],
                "credentials": openai_cred(),
                "parameters": {
                    "operation": "message",
                    "modelId": "gpt-4o-mini",
                    "messages": {
                        "values": [
                            {
                                "content": """Write a warm, brief outreach email for VenueDesk room booking CRM. Respond with ONLY valid JSON:
{"subject": "<subject>", "body": "<email body>"}

Venue: {{ $json.venue_name }}
Type: {{ $json.venue_type }}
Contact: {{ $json.contact_name || 'there' }}
Sign off as: The VenueDesk Team"""
                            }
                        ]
                    }
                }
            },
            {
                "id": "send5",
                "name": "Send Email",
                "type": "n8n-nodes-base.emailSend",
                "typeVersion": 2,
                "position": [920, 300],
                "credentials": smtp_cred(),
                "parameters": {
                    "fromEmail": "hello@venuedesk.co.uk",
                    "toEmail": "={{ $('Get Lead').first().json.email }}",
                    "subject": "={{ JSON.parse($json.message.content).subject }}",
                    "emailType": "text",
                    "text": "={{ JSON.parse($json.message.content).body }}",
                    "options": {}
                }
            },
            {
                "id": "pg5b",
                "name": "Update Status",
                "type": "n8n-nodes-base.postgres",
                "typeVersion": 2,
                "position": [1160, 300],
                "credentials": pg_cred(),
                "parameters": {
                    "operation": "executeQuery",
                    "query": "UPDATE leads SET status='contacted', last_email_sent_at=NOW() WHERE id='{{ $('Get Lead').first().json.id }}'"
                }
            },
            {
                "id": "resp5",
                "name": "Respond",
                "type": "n8n-nodes-base.respondToWebhook",
                "typeVersion": 1,
                "position": [1400, 300],
                "parameters": {
                    "respondWith": "json",
                    "responseBody": "={{ {success: true, message: 'Email queued'} }}"
                }
            }
        ],
        "connections": {
            "Webhook":       {"main": [[{"node": "Get Lead",       "type": "main", "index": 0}]]},
            "Get Lead":      {"main": [[{"node": "Generate Email", "type": "main", "index": 0}]]},
            "Generate Email":{"main": [[{"node": "Send Email",     "type": "main", "index": 0}]]},
            "Send Email":    {"main": [[{"node": "Update Status",  "type": "main", "index": 0}]]},
            "Update Status": {"main": [[{"node": "Respond",        "type": "main", "index": 0}]]}
        }
    }

# ─── Main ──────────────────────────────────────────────────────────────────
def main():
    print("\n🚀 VenueDesk AI Lead Generator — n8n Deployer")
    print("=" * 52)

    # Test connection
    print("\n1. Testing n8n connection...")
    info = api("get", "/workflows?limit=1")
    if info is None:
        print("  ✗ Cannot connect to n8n. Check API key / URL.")
        sys.exit(1)
    print(f"  ✓ Connected to {N8N_BASE}")

    print("\n2. Deploying workflows...")
    ids = {}

    ids["create_table"]  = create_workflow(wf_create_table())
    ids["leads_get"]     = create_workflow(wf_leads_get())
    ids["leads_add"]     = create_workflow(wf_leads_add())
    ids["leads_update"]  = create_workflow(wf_leads_update())
    ids["leads_activity"]= create_workflow(wf_leads_activity())
    ids["send_email"]    = create_workflow(wf_send_email_webhook())
    ids["ai_lead_gen"]   = create_workflow(wf_ai_lead_gen())

    print("\n3. Workflow summary:")
    print(f"  • Dashboard API endpoints — LIVE at {N8N_BASE}/webhook/")
    print(f"    GET  /leads-get       → fetch all leads")
    print(f"    POST /leads-add       → add a new lead")
    print(f"    POST /leads-update    → update lead status")
    print(f"    GET  /leads-activity  → activity feed")
    print(f"    POST /leads-send-email → send AI email to lead")

    print("\n⚠️  IMPORTANT — Manual setup required in n8n UI:")
    print("  1. Run 'VenueDesk — Create Leads Table' manually (one-off)")
    print("  2. Add OpenAI credential to AI nodes in 'AI Lead Generator (Daily)'")
    print("  3. Add SMTP credential to 'Send Email' nodes")
    print("  4. Activate 'VenueDesk — AI Lead Generator (Daily)' once ready")
    print("\n✅ All workflows deployed successfully!")

if __name__ == "__main__":
    main()
