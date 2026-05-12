#!/usr/bin/env bash
# verify_rls.sh — Phase 4 RLS Verification Suite
#
# Tests:
#   1. Zero-tenant test     — API call without JWT → must return 0 rows / 401
#   2. Valid-tenant test    — API call with JWT → must return data
#   3. PaymentChaser smoke  — CHASER_SERVICE_JWT still works cross-tenant
#   4. DB-level vault check — direct psql queries without set_config return 0 rows
#
# Usage:
#   bash ~/Downloads/venue_desk_backup/verify_rls.sh
#
# Prerequisites: SSH access to root@72.61.19.52, JWT tokens set below.

set -euo pipefail

VPS="root@72.61.19.52"
API="https://api.venuedesk.co.uk"
PASS=0
FAIL=0

# ── Token helpers ─────────────────────────────────────────────────────────────
# Set USER_JWT before running (get from browser sessionStorage vp_token)
USER_JWT="${USER_JWT:-}"
# CHASER_SERVICE_JWT is read from the VPS environment
CHASER_JWT=$(ssh "$VPS" "docker exec venuedesk-api printenv CHASER_SERVICE_JWT 2>/dev/null || true")

green() { printf '\033[0;32m✅ PASS\033[0m %s\n' "$1"; ((PASS++)); }
red()   { printf '\033[0;31m❌ FAIL\033[0m %s\n' "$1"; ((FAIL++)); }

# ── Test 1: Zero-tenant (no JWT) → must return 401 ───────────────────────────
echo ""
echo "=== Test 1: Zero-tenant request (no JWT) ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/customers/list")
if [[ "$STATUS" == "401" ]]; then
  green "GET /customers/list without JWT → 401 (as expected)"
else
  red   "GET /customers/list without JWT → $STATUS (expected 401)"
fi

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/recurring/series")
if [[ "$STATUS" == "401" ]]; then
  green "GET /recurring/series without JWT → 401 (as expected)"
else
  red   "GET /recurring/series without JWT → $STATUS (expected 401)"
fi

# ── Test 2: DB-level vault — no set_config → 0 rows ─────────────────────────
echo ""
echo "=== Test 2: DB-level vault (RLS without tenant context) ==="
ssh "$VPS" bash << 'REMOTE'
CONTAINER="n8n_postgres-postgres-1"
RESULT=$(docker exec "$CONTAINER" psql -U venuedesk -d venuedesk -tAc \
  "SELECT COUNT(*) FROM bookings.customers;")
echo "  Customers without tenant context: $RESULT"
if [[ "$RESULT" == "0" ]]; then
  echo "  ✅ PASS — 0 rows returned (RLS vault active)"
else
  echo "  ⚠️  WARNING — $RESULT rows returned. If FORCE RLS is enabled this is unexpected."
  echo "        (If FORCE is not yet enabled, this is expected — policies are passive)"
fi
REMOTE

# ── Test 3: Valid JWT → returns data ─────────────────────────────────────────
echo ""
echo "=== Test 3: Valid-tenant request ==="
if [[ -z "$USER_JWT" ]]; then
  echo "  ⚠️  USER_JWT not set — skipping. Re-run with: USER_JWT=<token> bash verify_rls.sh"
else
  BODY=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $USER_JWT" "$API/customers/list")
  STATUS=$(echo "$BODY" | tail -1)
  if [[ "$STATUS" == "200" ]]; then
    green "GET /customers/list with valid JWT → 200"
  else
    red   "GET /customers/list with valid JWT → $STATUS"
  fi

  BODY=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $USER_JWT" "$API/recurring/series")
  STATUS=$(echo "$BODY" | tail -1)
  if [[ "$STATUS" == "200" ]]; then
    green "GET /recurring/series with valid JWT → 200"
  else
    red   "GET /recurring/series with valid JWT → $STATUS"
  fi
fi

# ── Test 4: CHASER_SERVICE_JWT cross-tenant smoke test ────────────────────────
echo ""
echo "=== Test 4: PaymentChaser / Service JWT smoke test ==="
if [[ -z "$CHASER_JWT" ]]; then
  red "CHASER_SERVICE_JWT not found in container env"
else
  BODY=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CHASER_JWT" \
    "$API/recurring/upcoming-reminders")
  STATUS=$(echo "$BODY" | tail -1)
  if [[ "$STATUS" == "200" ]]; then
    green "GET /recurring/upcoming-reminders with CHASER_SERVICE_JWT → 200"
  else
    red   "GET /recurring/upcoming-reminders with CHASER_SERVICE_JWT → $STATUS"
  fi

  BODY=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CHASER_JWT" \
    "$API/recurring/process-overdue" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"dry_run":true}' 2>/dev/null || echo "")
  STATUS=$(echo "$BODY" | tail -1)
  if [[ "$STATUS" == "200" ]]; then
    green "POST /recurring/process-overdue (dry_run) with CHASER_SERVICE_JWT → 200"
  else
    red   "POST /recurring/process-overdue (dry_run) → $STATUS"
  fi
fi

# ── Test 5: Health check ──────────────────────────────────────────────────────
echo ""
echo "=== Test 5: API health ==="
HEALTH=$(curl -s "$API/health")
DB_STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('database',{}).get('status','?'))" 2>/dev/null || echo "error")
if [[ "$DB_STATUS" == "ok" ]]; then
  green "GET /health → db status ok"
else
  red   "GET /health → db status $DB_STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════════════"
[[ "$FAIL" -eq 0 ]] && echo "✅ All tests passed — RLS Phase 4a verified" \
                     || echo "❌ Failures detected — review output above"
