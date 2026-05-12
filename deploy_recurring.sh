#!/usr/bin/env bash
# Run from your Mac terminal:   bash ~/Downloads/venue_desk_backup/deploy_recurring.sh
set -e
VPS="root@srv1090894.hstgr.cloud"
REMOTE="/opt/n8n_postgres/venuedesk-api/src/routes/recurring.js"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Uploading recurring.js..."
cat "${SCRIPT_DIR}/recurring_deploy_payload.b64" | ssh "$VPS" "base64 -d > ${REMOTE} && echo 'Upload OK, lines: '\$(wc -l < ${REMOTE})"

echo "==> Verifying key changes landed..."
ssh "$VPS" "grep -n 'paid_sessions_count\|WITH ORDINALITY\|audit_logs\|recurring_series_id' ${REMOTE} | head -12"

echo "==> Hot-patching running container..."
ssh "$VPS" "
  CONTAINER=\$(docker ps --filter name=venuedesk-api --format '{{.Names}}' | head -1)
  docker cp ${REMOTE} \${CONTAINER}:/app/src/routes/recurring.js
  docker exec \${CONTAINER} node -e \"require('./src/routes/recurring'); console.log('syntax OK')\" 2>&1
"

echo "==> Rebuilding image (docker compose v2)..."
ssh "$VPS" "
  cd /opt/n8n_postgres
  docker compose build venuedesk-api --no-cache 2>&1 | tail -6
  docker compose up -d --force-recreate venuedesk-api 2>&1 | tail -4
  sleep 10
  curl -s -o /dev/null -w 'Healthcheck: HTTP %{http_code}\n' http://localhost:3000/health
"
echo "==> Done."
