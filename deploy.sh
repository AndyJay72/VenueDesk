#!/bin/bash
set -e
VPS=root@72.61.19.52
S=/opt/n8n_postgres/venuedesk-api/src
L=~/Downloads/venue_desk_backup/venuedesk-api/src

scp $L/routes/config.js $VPS:$S/routes/config.js
ssh $VPS "docker cp $S/routes/config.js venuedesk-api:/app/src/routes/config.js"
ssh $VPS "docker restart venuedesk-api && sleep 6 && docker logs venuedesk-api --tail 5"
