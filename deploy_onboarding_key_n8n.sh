#!/usr/bin/env bash
# deploy_onboarding_key_n8n.sh
# Copies the ONBOARDING_ADMIN_KEY that already exists in the venuedesk-api
# environment block into the n8n service environment block as well, then
# force-recreates n8n so workflows can reference it as $env.ONBOARDING_ADMIN_KEY.
#
# Run AFTER deploy_onboarding_key.sh (which injects the key into venuedesk-api).
#
# Usage:
#   bash ~/Downloads/venue_desk_backup/deploy_onboarding_key_n8n.sh

set -euo pipefail

VPS="root@72.61.19.52"
COMPOSE_FILE="/opt/n8n_postgres/docker-compose.yml"

echo "=== Step 1: Read ONBOARDING_ADMIN_KEY from VPS compose file ==="
KEY=$(ssh "$VPS" bash -s << 'REMOTE'
grep -E '^\s*(- )?ONBOARDING_ADMIN_KEY\s*[:=]' /opt/n8n_postgres/docker-compose.yml \
  | head -1 \
  | sed 's/.*[:=]\s*//' \
  | tr -d '"'"'"' '
REMOTE
)

if [[ -z "$KEY" ]]; then
  echo "ERROR: ONBOARDING_ADMIN_KEY not found in docker-compose.yml."
  echo "       Run deploy_onboarding_key.sh first."
  exit 1
fi

echo "Key found: ${KEY:0:16}..."

echo ""
echo "=== Step 2: Inject ONBOARDING_ADMIN_KEY into n8n service block ==="
ssh "$VPS" bash -s << REMOTE
set -euo pipefail
KEY="${KEY}"
COMPOSE="${COMPOSE_FILE}"

cp "\$COMPOSE" "\${COMPOSE}.bak.\$(date +%Y%m%d%H%M%S)"
echo "Backup created."

if grep -A 50 '^\s\{2\}n8n:' "\$COMPOSE" | grep -q 'ONBOARDING_ADMIN_KEY'; then
  # Key already in n8n block — update it
  # Use Python for precision (avoid matching the venuedesk-api block)
  python3 - "\$COMPOSE" "\${KEY}" << 'PY'
import sys, re

compose_path = sys.argv[1]
key_value    = sys.argv[2]

with open(compose_path) as f:
    lines = f.readlines()

in_n8n = False
for i, line in enumerate(lines):
    stripped = line.lstrip()
    indent   = len(line) - len(stripped)

    if re.match(r'^\s{2}n8n\s*:', line):
        in_n8n = True
        continue
    if in_n8n and stripped and indent <= 2:
        in_n8n = False
        continue
    if in_n8n and 'ONBOARDING_ADMIN_KEY' in line:
        # Replace this line
        leading = re.match(r'^(\s*(?:- )?)', line).group(1)
        if '- ' in leading:
            lines[i] = f"{leading}ONBOARDING_ADMIN_KEY={key_value}\n"
        else:
            lines[i] = f"{leading}ONBOARDING_ADMIN_KEY: {key_value}\n"
        break

with open(compose_path, "w") as f:
    f.writelines(lines)
print("ONBOARDING_ADMIN_KEY updated in n8n block.")
PY
else
  # Insert into n8n environment block
  python3 - "\$COMPOSE" "\${KEY}" << 'PY'
import sys, re

compose_path = sys.argv[1]
key_value    = sys.argv[2]

with open(compose_path) as f:
    lines = f.readlines()

in_n8n     = False
in_env     = False
insert_at  = None
env_indent = "      "

for i, line in enumerate(lines):
    stripped = line.lstrip()
    indent   = len(line) - len(stripped)

    if re.match(r'^\s{2}n8n\s*:', line):
        in_n8n = True
        in_env = False
        continue

    if in_n8n and stripped and indent <= 2:
        in_n8n = False

    if not in_n8n:
        continue

    if re.match(r'^\s+environment\s*:', line):
        in_env     = True
        env_indent = " " * (indent + 2)
        continue

    if not in_env:
        continue

    if stripped and (re.match(r'^[A-Z_a-z]', stripped) or stripped.startswith("- ")):
        if indent >= len(env_indent):
            insert_at = i
            continue

    if stripped and not stripped.startswith("#"):
        if indent < len(env_indent):
            in_env = False

if insert_at is None:
    print("ERROR: Could not locate n8n environment block.", file=sys.stderr)
    sys.exit(1)

sample = lines[insert_at].lstrip()
if sample.startswith("- "):
    new_line = f"{env_indent}- ONBOARDING_ADMIN_KEY={key_value}\n"
else:
    new_line = f"{env_indent}ONBOARDING_ADMIN_KEY: {key_value}\n"

lines.insert(insert_at + 1, new_line)

with open(compose_path, "w") as f:
    f.writelines(lines)

print(f"Inserted ONBOARDING_ADMIN_KEY into n8n block at line {insert_at + 2}.")
PY
fi

echo ""
echo "Verifying n8n block:"
# Print the n8n service env section and filter for our key
awk '/^\s{2}n8n:/{found=1} found && /ONBOARDING_ADMIN_KEY/{print; found=0}' "\$COMPOSE" \
  | sed 's/[=:].*/: <key_hidden>/'
REMOTE

echo ""
echo "=== Step 3: Force-recreate n8n container ==="
ssh "$VPS" "cd /opt/n8n_postgres && docker compose up -d --force-recreate n8n 2>&1"

echo ""
echo "=== Step 4: Verify env var is live in n8n container ==="
sleep 5
ssh "$VPS" bash << 'REMOTE'
echo "n8n container status:"
docker ps --filter name=n8n --format "  {{.Names}}  {{.Status}}"

echo ""
echo "Env var present in n8n:"
docker exec $(docker ps -qf name=n8n | head -1) printenv ONBOARDING_ADMIN_KEY \
  | awk '{print "  " substr($0,1,16) "...  (key set)"}' \
  || echo "  (NOT FOUND — check compose file)"
REMOTE

echo ""
echo "=== Step 5: Sync updated compose file back to Mac ==="
scp "$VPS:$COMPOSE_FILE" \
    ~/Downloads/venue_desk_backup/venuedesk-api/docker-compose.yml
echo "Local backup updated."

echo ""
echo "=== Done ==="
echo "\$env.ONBOARDING_ADMIN_KEY is now available in all n8n HTTP nodes."
echo ""
echo "Import OnboardingManager.json in the n8n UI to complete the migration."
