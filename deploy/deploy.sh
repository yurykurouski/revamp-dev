#!/usr/bin/env bash
# ==============================================================================
# Revamp SaaS - Production Deployment Script
# ==============================================================================
# Automates zero-downtime rolling deployment on a VPS (Hetzner, DO, etc.)
# Usage: ./deploy/deploy.sh [--skip-pull]
# ==============================================================================

set -euo pipefail

# ANSI color codes for readable output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Determine project root directory (parent of deploy/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

log_info "Initiating Revamp Production Deployment from: ${PROJECT_ROOT}"

# ------------------------------------------------------------------------------
# 1. Preflight System Checks
# ------------------------------------------------------------------------------
log_info "Verifying prerequisites..."

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker Engine 24+ first."
    exit 1
fi

if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running or current user lacks permission."
    exit 1
fi

if ! docker compose version &> /dev/null; then
    log_error "Docker Compose v2 plugin is required ('docker compose')."
    exit 1
fi

if [ ! -f ".env.production" ]; then
    log_error ".env.production file is missing in ${PROJECT_ROOT}!"
    log_info "Please copy .env.production.example to .env.production and configure your credentials."
    exit 1
fi

if [ ! -f "docker-compose.prod.yml" ]; then
    log_error "docker-compose.prod.yml manifest not found!"
    exit 1
fi

log_success "Prerequisites verified."

# ------------------------------------------------------------------------------
# 2. Git Synchronization (optional via flag)
# ------------------------------------------------------------------------------
SKIP_PULL=false
for arg in "$@"; do
    if [ "$arg" == "--skip-pull" ]; then
        SKIP_PULL=true
    fi
done

if [ "$SKIP_PULL" = false ] && [ -d ".git" ]; then
    log_info "Synchronizing latest changes from main branch..."
    git pull origin main --ff-only || log_warn "Could not fast-forward git pull. Continuing with local code."
else
    log_info "Skipping git pull."
fi

# ------------------------------------------------------------------------------
# 3. Build Production Docker Images
# ------------------------------------------------------------------------------
log_info "Building production containers (API, Workers, Dashboard)..."
docker compose -f docker-compose.prod.yml build --pull
log_success "All images built successfully."

# ------------------------------------------------------------------------------
# 4. Deploy Containers
# ------------------------------------------------------------------------------
log_info "Launching production containers..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans
log_success "Containers deployed."

# ------------------------------------------------------------------------------
# 5. Smoke Test & Health Check Probe Loop
# ------------------------------------------------------------------------------
log_info "Performing healthcheck probe on REST API (up to 30s)..."

MAX_RETRIES=10
RETRY_COUNT=0
HEALTHY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    
    # Attempt querying health check from container
    if docker exec revamp-prod-api curl -s -f http://localhost:4000/api/v1/health &> /dev/null; then
        HEALTHY=true
        break
    fi
    
    log_warn "Healthcheck attempt ${RETRY_COUNT}/${MAX_RETRIES} pending. Waiting 3s..."
    sleep 3
done

if [ "$HEALTHY" = true ]; then
    log_success "Healthcheck probe passed! System is operational."
    
    # Fetch detailed health payload
    docker exec revamp-prod-api curl -s http://localhost:4000/api/v1/health || true
    echo ""
else
    log_error "Healthcheck failed after ${MAX_RETRIES} attempts!"
    log_warn "Displaying last 50 lines of API and Workers logs:"
    docker compose -f docker-compose.prod.yml logs --tail 50 api workers
    exit 1
fi

# ------------------------------------------------------------------------------
# 6. Cleanup Dangling Docker Images
# ------------------------------------------------------------------------------
log_info "Pruning stale Docker images to conserve VPS disk storage..."
docker image prune -f --filter "until=24h" || true

log_success "=== Revamp SaaS Production Deployment Completed Successfully! ==="
