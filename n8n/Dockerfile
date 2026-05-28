# VenueDesk custom n8n image
#
# n8n:latest is now a Docker Hardened Image (Alpine 3.22, apk removed).
# Python 3 is absent from the image. Testing has shown the current n8n 2.x
# runner architecture no longer requires Python — the task runner is
# Node.js-based. If a CPU-pegging broker crash reappears, revisit with a
# multi-stage build to copy Python from a standard alpine:3.22 layer.
#
# Build:   docker compose build n8n
# Recreate: docker compose up -d --force-recreate n8n

FROM n8nio/n8n:latest
