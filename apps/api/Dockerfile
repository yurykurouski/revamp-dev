# syntax=docker/dockerfile:1
# ==========================================
# 1. Base Builder
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations and package definitions
COPY package*.json tsconfig.base.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/validation/package*.json ./packages/validation/
COPY packages/validation/tsconfig.json ./packages/validation/
COPY packages/db/package*.json ./packages/db/
COPY packages/db/tsconfig.json ./packages/db/
COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/

# Install full dependencies for building
# REV-220: BuildKit keeps npm's download cache between builds, so a changed lockfile re-downloads only what changed
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code
COPY packages/shared-types ./packages/shared-types
COPY packages/validation ./packages/validation
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# Build shared packages (types, validation, models) and API service
RUN npm run build --workspace=@revamp/shared-types && \
    npm run build --workspace=@revamp/validation && \
    npm run build --workspace=@revamp/db && \
    npm run build --workspace=@revamp/api

# Prune dev dependencies for lean production footprint
RUN npm prune --production

# ==========================================
# 2. Production Runner
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Run as non-root user
USER node

# Copy built runtime dependencies and compiled outputs
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --chown=node:node --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --chown=node:node --from=builder /app/packages/validation/dist ./packages/validation/dist
COPY --chown=node:node --from=builder /app/packages/validation/package.json ./packages/validation/package.json
COPY --chown=node:node --from=builder /app/packages/db/dist ./packages/db/dist
COPY --chown=node:node --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=builder /app/apps/api/src/public ./apps/api/dist/public

EXPOSE 4000

# REV-217: Node itself probes /health, so the image needs no extra HTTP client
# The Node probe takes about 2 s on a busy machine, so the timeout leaves room for it
HEALTHCHECK --interval=15s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "apps/api/dist/index.js"]
