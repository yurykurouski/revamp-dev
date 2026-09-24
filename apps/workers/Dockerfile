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
COPY apps/workers/package*.json ./apps/workers/
COPY apps/workers/tsconfig.json ./apps/workers/

# Install full dependencies for compilation
RUN npm ci

# Copy source code
COPY packages/shared-types ./packages/shared-types
COPY packages/validation ./packages/validation
COPY apps/workers ./apps/workers

# Build shared packages and background workers
RUN npm run build --workspace=@revamp/shared-types && \
    npm run build --workspace=@revamp/validation && \
    npm run build --workspace=@revamp/workers

# Prune dev dependencies
RUN npm prune --production

# ==========================================
# 2. Production Runner with Playwright Chromium
# ==========================================
FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy dependencies and compiled distribution bundles
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/packages/validation/dist ./packages/validation/dist
COPY --from=builder /app/packages/validation/package.json ./packages/validation/package.json
COPY --from=builder /app/apps/workers/dist ./apps/workers/dist
COPY --from=builder /app/apps/workers/package.json ./apps/workers/package.json

# Install headless Chromium browser for Playwright audit crawling
RUN npx playwright install chromium

CMD ["node", "apps/workers/dist/index.js"]
