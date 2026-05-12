# ─────────────────────────────────────────────────────────────────────────────
# VenueDesk API v2 — Production Dockerfile
# Build:  docker compose build venuedesk-api
# Run:    docker compose up venuedesk-api
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency install ───────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first — Docker cache will skip npm ci on unchanged lockfiles.
COPY package.json package-lock.json* ./

# Install production deps only; --omit=dev keeps the image lean.
# If no lockfile exists yet, fall back to npm install.
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: never run as root inside the container.
RUN addgroup -S venuedesk && adduser -S venuedesk -G venuedesk

WORKDIR /app

# Pull in only the installed node_modules from the build stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy application source — everything not excluded by .dockerignore.
COPY src ./src
COPY package.json ./

# Ensure the Node process can read all source files.
RUN chown -R venuedesk:venuedesk /app

USER venuedesk

EXPOSE 3000

# Prefer the explicit start script over `node src/server.js` so package.json
# remains the single source of truth for the entry point.
CMD ["node", "src/server.js"]
