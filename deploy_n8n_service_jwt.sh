#!/usr/bin/env bash
# deploy_n8n_service_jwt.sh
# Generates N8N_SERVICE_JWT (tenant-scoped service token) and injects it into
# docker-compose.yml, then force-recreates the n8n container so it picks up
# $env.N8N_SERVICE_JWT in all HTTP Request node expressions.
#
# Usage (run from your Mac):
#   bash ~/Downloads/venue_desk_backup/deploy_n8n_service_jwt.sh
#
# Requirements: SSH access to root@72.61.19.52

set -euo pipefail

VPS="root@72.61.19.52"
COMPOSE_FILE="/opt/n8n_postgres/docker-compose.yml"
CONTAINER="venuedesk-api"

echo "=== Step 1: Generate N8N_SERVICE_JWT on VPS ==="
TOKEN=$(ssh "$VPS" bash -s << 'REMOTE'
set -euo pipefail

# Extract JWT_SECRET from docker-compose.yml (handles both KEY=value and KEY: value formats)
JWT_SECRET=$(grep -E '^\s*(- )?JWT_SECRET\s*[:=]' /opt/n8n_postgres/docker-compose.yml \
  | head -1 \
  | sed 's/.*[:=]\s*//' \
  | tr -d '"'"'"' ')

if [[ -z "$JWT_SECRET" ]]; then
  echo "ERROR: Could not extract JWT_SECRET from docker-compose.yml" >&2
  exit 1
fi

echo "JWT_SECRET found (${#JWT_SECRET} chars)" >&2

# Generate the token inside the running venuedesk-api container
# (guarantees same jsonwebtoken version + same secret)
node -e "
const crypto = require('crypto');
const b64u = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const hdr  = b64u({ alg: 'HS256', typ: 'JWT' });
const pay  = b64u({ id: 'n8n-service', user_id: 'n8n-service', role: 'service', tenant_id: 1001, iat: Math.floor(Date.now()/1000) });
const sig  = crypto.createHmac('sha256', '${JWT_SECRET}').update(hdr + '.' + pay).digest('base64url');
process.stdout.write(hdr + '.' + pay + '.' + sig);
"
REMOTE
)

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Token generation failed — check VPS logs above." >&2
  exit 1
fi

echo "Token generated: ${TOKEN:0:40}..."

echo ""
echo "=== Step 2: Inject N8N_SERVICE_JWT into docker-compose.yml ==="
ssh "$VPS" bash -s << REMOTE
set -euo pipefail
TOKEN="${TOKEN}"
COMPOSE="${COMPOSE_FILE}"

# Back up the compose file before editing
cp "\$COMPOSE" "\${COMPOSE}.bak.\$(date +%Y%m%d%H%M%S)"
echo "Backup created."

# Check if the key already exists in the file
if grep -q 'N8N_SERVICE_JWT' "\$COMPOSE"; then
  # Update the existing line in-place — handles both dict (KEY: val) and list (- KEY=val) formats
  sed -i "s|^\(\s*\)\(- \)\?N8N_SERVICE_JWT[=:][^\n]*|\1N8N_SERVICE_JWT:        \${TOKEN}|" "\$COMPOSE"
  echo "N8N_SERVICE_JWT updated in \$COMPOSE."
else
  # Insert N8N_SERVICE_JWT into the n8n service's environment block.
  # The n8n service uses dict-style env vars (KEY: value), not list style (- KEY=value).
  python3 - "\$COMPOSE" "\${TOKEN}" << 'PY'
import sys, re

compose_path = sys.argv[1]
token        = sys.argv[2]

with open(compose_path) as f:
    lines = f.readlines()

in_n8n      = False
in_env      = False
insert_at   = None
env_indent  = "      "  # default 6-space indent for env vars under services.n8n

for i, line in enumerate(lines):
    stripped = line.lstrip()
    indent   = len(line) - len(stripped)

    # Detect entering the n8n service block (service key at 2-space indent)
    if re.match(r'^\s{2}n8n\s*:', line):
        in_n8n = True
        in_env = False
        continue

    # Detect leaving n8n block (another key at same or shallower indent)
    if in_n8n and stripped and indent <= 2 and not re.match(r'^\s{2}n8n\s*:', line):
        in_n8n = False

    if not in_n8n:
        continue

    # Detect environment: section inside n8n block
    if re.match(r'^\s+environment\s*:', line):
        in_env     = True
        env_indent = " " * (indent + 2)   # env vars are indented 2 more than 'environment:'
        continue

    if not in_env:
        continue

    # Track last env var line (dict KEY: val style OR list - KEY=val style)
    if stripped and (re.match(r'^[A-Z_]', stripped) or stripped.startswith("- ")):
        # Check we're still inside the env block (deeper than the 'environment:' key)
        if indent >= len(env_indent):
            insert_at = i
            continue

    # Leaving environment block (non-empty, non-comment line at shallower indent)
    if stripped and not stripped.startswith("#"):
        if indent < len(env_indent):
            in_env = False

if insert_at is None:
    print("ERROR: Could not locate n8n environment block in compose file.", file=sys.stderr)
    sys.exit(1)

# Match the indentation style already in use (dict or list)
sample = lines[insert_at].lstrip()
if sample.startswith("- "):
    new_line = f"{env_indent}- N8N_SERVICE_JWT={token}\n"
else:
    new_line = f"{env_indent}N8N_SERVICE_JWT:        {token}\n"

lines.insert(insert_at + 1, new_line)

with open(compose_path, "w") as f:
    f.writelines(lines)

print(f"Inserted N8N_SERVICE_JWT at line {insert_at + 2}.")
PY
fi

echo ""
echo "Verifying injection:"
grep 'N8N_SERVICE_JWT' "\$COMPOSE" | sed 's/[=:].*/: <token_hidden>/'
REMOTE

echo ""
echo "=== Step 3: Force-recreate n8n container to pick up new env var ==="
ssh "$VPS" "cd /opt/n8n_postgres && docker compose up -d --force-recreate n8n 2>&1"

echo ""
echo "=== Step 4: Verify n8n restarted and env var is live ==="
sleep 5
ssh "$VPS" bash << 'REMOTE'
echo "n8n container status:"
docker ps --filter name=n8n --format "  {{.Names}}  {{.Status}}"

echo ""
echo "Env var present in container:"
docker exec $(docker ps -qf name=n8n | head -1) printenv N8N_SERVICE_JWT \
  | awk '{print "  " substr($0,1,40) "..."}' \
  || echo "  (not found — check compose file)"
REMOTE

echo ""
echo "=== Done ==="
echo "N8N_SERVICE_JWT is now available as \$env.N8N_SERVICE_JWT in all n8n HTTP nodes."
echo ""
echo "Next: re-import the 12 rewritten workflow JSONs in the n8n UI:"
echo "  Deactivate -> Delete -> Import from ~/Downloads/venue_desk_backup/n8n-workflows/ -> Activate"
echo ""
echo "Workflows to import:"
for f in \
  hBclMCxbgmz7f3Za.json \
  KHvxUBua7hi5e1x1.json \
  7ZXOI73BhHLXkyOc.json \
  eI6PSBE1TbpaRx9K.json \
  AGkUe3zjjFDD0wOL.json \
  B1NXZMSxwOD6bDHB.json \
  K3oWOutGQuE9HWfm.json \
  nW4p6cg3l7OHwjQP.json \
  oxBp6cEoB3ZBRwB2.json \
  baGN4RUcgtsDTISA.json \
  W6tKvBknt31j0ddx.json \
  3JqHCjua5lKZGpeB.json; do
  echo "  ~/Downloads/venue_desk_backup/n8n-workflows/$f"
done
