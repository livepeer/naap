#!/bin/bash

# NAAP Platform - Database Migration Script
# Runs Prisma migrations for a specific service or all services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SERVICE="${1:-}"

get_service_path() {
  local service=$1
  if [ "$service" = "base-svc" ] || [ "$service" = "base" ]; then
    echo "$ROOT_DIR/services/base-svc"
  else
    local workflow_name="${service%-svc}"
    echo "$ROOT_DIR/services/workflows/$service"
  fi
}

run_migration() {
  local service=$1
  local service_path=$(get_service_path "$service")
  
  if [ ! -f "$service_path/prisma/schema.prisma" ]; then
    log_warn "No Prisma schema found for $service, skipping..."
    return
  fi
  
  log_info "Running migrations for $service..."
  cd "$service_path"
  
  if npx prisma migrate deploy; then
    log_success "Migrations completed for $service"
  else
    log_error "Migration failed for $service"
    return 1
  fi
  
  cd "$ROOT_DIR"
}

if [ -z "$SERVICE" ]; then
  # Run migrations for all services
  log_info "Running migrations for all services..."
  
  services=("base-svc" "gateway-manager-svc" "orchestrator-manager-svc" "capacity-planner-svc" "network-analytics-svc" "marketplace-svc" "community-svc")
  
  for service in "${services[@]}"; do
    run_migration "$service" || true
  done
  
  log_success "All migrations completed!"
else
  # Run migration for specific service
  run_migration "$SERVICE"
fi
