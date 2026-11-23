# syntax=docker/dockerfile:1
# ==========================================
# 1. Base Builder
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy root workspace configurations and package definitions
COPY package*.json tsconfig.base.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/validation/package*.json ./packages/validation/
COPY packages/validation/tsconfig.json ./packages/validation/
COPY packages/db/package*.json ./packages/db/
COPY packages/db/tsconfig.json ./packages/db/
COPY apps/workers/package*.json ./apps/workers/
COPY apps/workers/tsconfig.json ./apps/workers/

# Install full dependencies for compilation
# REV-220: BuildKit keeps npm's download cache between builds, so a changed lockfile re-downloads only what changed
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code
COPY packages/shared-types ./packages/shared-types
COPY packages/validation ./packages/validation
COPY packages/db ./packages/db
COPY apps/workers ./apps/workers

# Build shared packages (types, validation, models) and background workers
RUN npm run build --workspace=@revamp/shared-types && \
    npm run build --workspace=@revamp/validation && \
    npm run build --workspace=@revamp/db && \
    npm run build --workspace=@revamp/workers

# Prune dev dependencies
RUN npm prune --production

# ==========================================
# 2. Production Runner with Playwright Chromium (REV-217)
# ==========================================
# A slim Node base plus the one browser the audits launch. The headless shell is enough:
# browser.service.ts always starts Chromium with `headless: true`. The browser build comes from the
# installed Playwright version (node_modules), so the library and the browser cannot drift apart.
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependencies change rarely: copy them, then install the browser, before the frequently changing dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# System libraries and the headless shell in one layer; the apt lists and caches are removed in it
RUN node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/* \
    && chmod -R a+rX /ms-playwright

# Compiled distribution bundles
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/packages/validation/dist ./packages/validation/dist
COPY --from=builder /app/packages/validation/package.json ./packages/validation/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist
COPY --from=builder /app/apps/workers/package.json ./apps/workers/package.json

# The workers listen on no port. They touch /tmp/revamp-workers-heartbeat while MongoDB and Redis are
# connected (apps/workers/src/services/heartbeat.ts), and Docker watches that file.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD test -n "$(find /tmp/revamp-workers-heartbeat -mmin -1 2>/dev/null)" || exit 1

CMD ["node", "apps/workers/dist/index.js"]
