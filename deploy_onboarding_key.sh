#!/usr/bin/env bash
# deploy_onboarding_key.sh
# Adds ONBOARDING_ADMIN_KEY to docker-compose.yml under the venuedesk-api
# service environment block, then force-recreates the container so it picks
# up the new env var.
#
# Usage (run from your Mac):
#   bash ~/Downloads/venue_desk_backup/deploy_onboarding_key.sh
#
# To set a custom key instead of the default:
#   ONBOARDING_ADMIN_KEY=my-secret bash ~/Downloads/venue_desk_backup/deploy_onboarding_key.sh
#
# Requirements: SSH access to root@72.61.19.52

set -euo pipefail

VPS="root@72.61.19.52"
COMPOSE_FILE="/opt/n8n_postgres/docker-compose.yml"
CONTAINER="venuedesk-api"

# ── Key value ──────────────────────────────────────────────────────────────────
# Use the env var if provided, otherwise generate a secure random 32-byte hex key.
# The old n8n workflow hardcoded 'vp-admin-change-me' — we do better by default.
if [[ -n "${ONBOARDING_ADMIN_KEY:-}" ]]; then
  KEY="$ONBOARDING_ADMIN_KEY"
  echo "=== Using provided ONBOARDING_ADMIN_KEY ==="
else
  echo "=== Step 1: Generate secure ONBOARDING_ADMIN_KEY ==="
  KEY=$(openssl rand -hex 32)
  echo "Generated key: ${KEY:0:16}...  (32 bytes, hex-encoded)"
fi

echo ""
echo "=== Step 2: Inject ONBOARDING_ADMIN_KEY into docker-compose.yml ==="
ssh "$VPS" bash -s << REMOTE
set -euo pipefail
KEY="${KEY}"
COMPOSE="${COMPOSE_FILE}"

# Back up before editing
cp "\$COMPOSE" "\${COMPOSE}.bak.\$(date +%Y%m%d%H%M%S)"
echo "Backup created."

# Check if key already exists — update in-place if so
if grep -q 'ONBOARDING_ADMIN_KEY' "\$COMPOSE"; then
  sed -i "s|^\(\s*\)ONBOARDING_ADMIN_KEY[=:][^\n]*|\1ONBOARDING_ADMIN_KEY: \${KEY}|" "\$COMPOSE"
  echo "ONBOARDING_ADMIN_KEY updated."
else
  # Insert after the venuedesk-api environment block using Python
  # (same safe YAML-editing approach as deploy_n8n_service_jwt.sh)
  python3 - "\$COMPOSE" "\${KEY}" << 'PY'
import sys, re

compose_path = sys.argv[1]
key_value    = sys.argv[2]

with open(compose_path) as f:
    lines = f.readlines()

in_api     = False
in_env     = False
insert_at  = None
env_indent = "      "

for i, line in enumerate(lines):
    stripped = line.lstrip()
    indent   = len(line) - len(stripped)

    # Detect venuedesk-api service block (2-space indent service key)
    if re.match(r'^\s{2}venuedesk-api\s*:', line):
        in_api = True
        in_env = False
        continue

    # Leaving venuedesk-api block (another top-level key at same indent)
    if in_api and stripped and indent <= 2 and not re.match(r'^\s{2}venuedesk-api\s*:', line):
        in_api = False

    if not in_api:
        continue

    # Detect environment: section inside venuedesk-api block
    if re.match(r'^\s+environment\s*:', line):
        in_env     = True
        env_indent = " " * (indent + 2)
        continue

    if not in_env:
        continue

    # Track last env var line (dict KEY: val or list - KEY=val)
    if stripped and (re.match(r'^[A-Z_a-z]', stripped) or stripped.startswith("- ")):
        if indent >= len(env_indent):
            insert_at = i
            continue

    # Leaving environment block
    if stripped and not stripped.startswith("#"):
        if indent < len(env_indent):
            in_env = False

if insert_at is None:
    print("ERROR: Could not locate venuedesk-api environment block.", file=sys.stderr)
    sys.exit(1)

# Match existing style (dict or list)
sample = lines[insert_at].lstrip()
if sample.startswith("- "):
    new_line = f"{env_indent}- ONBOARDING_ADMIN_KEY={key_value}\n"
else:
    new_line = f"{env_indent}ONBOARDING_ADMIN_KEY: {key_value}\n"

lines.insert(insert_at + 1, new_line)

with open(compose_path, "w") as f:
    f.writelines(lines)

print(f"Inserted ONBOARDING_ADMIN_KEY at line {insert_at + 2}.")
PY
fi

echo ""
echo "Verifying injection:"
grep 'ONBOARDING_ADMIN_KEY' "\$COMPOSE" | sed 's/[=:].*/: <key_hidden>/'
REMOTE

echo ""
echo "=== Step 3: Force-recreate venuedesk-api container ==="
ssh "$VPS" "cd /opt/n8n_postgres && docker compose up -d --force-recreate venuedesk-api 2>&1"

echo ""
echo "=== Step 4: Verify env var is live in container ==="
sleep 4
ssh "$VPS" bash << 'REMOTE'
echo "Container status:"
docker ps --filter name=venuedesk-api --format "  {{.Names}}  {{.Status}}"

echo ""
echo "Env var present:"
docker exec venuedesk-api printenv ONBOARDING_ADMIN_KEY \
  | awk '{print "  " substr($0,1,16) "...  (key set)"}' \
  || echo "  (NOT FOUND — check compose file)"
REMOTE

echo ""
echo "=== Step 5: Sync updated docker-compose.yml back to Mac ==="
scp "$VPS:$COMPOSE_FILE" \
    ~/Downloads/venue_desk_backup/venuedesk-api/docker-compose.yml
echo "Local backup updated: ~/Downloads/venue_desk_backup/venuedesk-api/docker-compose.yml"

echo ""
echo "=== Done ==="
echo ""
echo "ONBOARDING_ADMIN_KEY is now live in the venuedesk-api container."
echo ""
echo "Next steps:"
echo "  1. Import OnboardingManager.json in the n8n UI"
echo "     (Deactivate old -> Delete -> Import -> Activate)"
echo ""
echo "  2. Add ONBOARDING_ADMIN_KEY to n8n's environment so workflows"
echo "     can reference it as \$env.ONBOARDING_ADMIN_KEY:"
echo "     Run: bash ~/Downloads/venue_desk_backup/deploy_n8n_service_jwt.sh"
echo "     ... or manually add it to the n8n service block in docker-compose.yml"
echo ""
echo "  3. When going to production, rotate to a new key:"
echo "     openssl rand -hex 32"
echo "     Then re-run this script with:"
echo "     ONBOARDING_ADMIN_KEY=<new-key> bash deploy_onboarding_key.sh"
