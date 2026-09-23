#!/bin/bash
set -e
VPS=root@72.61.19.52
SRC=~/Downloads/venue_desk_backup/venuedesk-api/src
DEST=/opt/n8n_postgres/venuedesk-api/src

scp $SRC/routes/config.js $VPS:$DEST/routes/config.js
ssh $VPS "docker cp $DEST/routes/config.js venuedesk-api:/app/src/routes/config.js"
ssh $VPS "docker restart venuedesk-api && sleep 6 && docker logs venuedesk-api --tail 5"
echo "--- smoke test (expect 401) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.venuedesk.co.uk/config/rooms/hard-delete
