# ==========================================
# 1. Base Builder
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

# Copy root workspace configurations and package definitions
COPY package*.json tsconfig.base.json ./
COPY packages/shared-types/package*.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY packages/validation/package*.json ./packages/validation/
COPY packages/validation/tsconfig.json ./packages/validation/
COPY apps/dashboard/package*.json ./apps/dashboard/
COPY apps/dashboard/tsconfig.json ./apps/dashboard/
COPY apps/dashboard/vite.config.ts ./apps/dashboard/

# Install full dependencies for building
RUN npm ci

# Copy source code
COPY packages/shared-types ./packages/shared-types
COPY packages/validation ./packages/validation
COPY apps/dashboard ./apps/dashboard

# Build shared packages and React Vite dashboard
RUN npm run build --workspace=@revamp/shared-types && \
    npm run build --workspace=@revamp/validation && \
    npm run build --workspace=@revamp/dashboard

# ==========================================
# 2. Production Web Server (Nginx)
# ==========================================
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
