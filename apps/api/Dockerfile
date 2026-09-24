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
COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/

# Install full dependencies for building
RUN npm ci

# Copy source code
COPY packages/shared-types ./packages/shared-types
COPY packages/validation ./packages/validation
COPY apps/api ./apps/api

# Build shared packages and API service
RUN npm run build --workspace=@revamp/shared-types && \
    npm run build --workspace=@revamp/validation && \
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

# Install curl for container healthcheck
RUN apk add --no-cache curl

# Run as non-root user
USER node

# Copy built runtime dependencies and compiled outputs
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --chown=node:node --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --chown=node:node --from=builder /app/packages/validation/dist ./packages/validation/dist
COPY --chown=node:node --from=builder /app/packages/validation/package.json ./packages/validation/package.json
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=builder /app/apps/api/src/public ./apps/api/dist/public

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/v1/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
