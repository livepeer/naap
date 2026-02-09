#!/bin/bash

# NAAP Platform - Database Seed Script
# Runs seed scripts for a specific service or all services

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
RESET="${2:-}"

get_service_path() {
  local service=$1
  if [ "$service" = "base-svc" ] || [ "$service" = "base" ]; then
    echo "$ROOT_DIR/services/base-svc"
  else
    local workflow_name="${service%-svc}"
    echo "$ROOT_DIR/services/workflows/$service"
  fi
}

run_seed() {
  local service=$1
  local service_path=$(get_service_path "$service")
  
  if [ ! -f "$service_path/prisma/seed.ts" ]; then
    log_warn "No seed script found for $service, skipping..."
    return
  fi
  
  log_info "Seeding database for $service..."
  cd "$service_path"
  
  if [ "$RESET" = "--reset" ]; then
    log_info "Resetting database before seeding..."
    npx prisma migrate reset --force --skip-seed
  fi
  
  if npx tsx prisma/seed.ts; then
    log_success "Seeding completed for $service"
  else
    log_error "Seeding failed for $service"
    return 1
  fi
  
  cd "$ROOT_DIR"
}

if [ -z "$SERVICE" ]; then
  # Run seeds for all services
  log_info "Seeding all databases..."
  
  services=("base-svc" "gateway-manager-svc" "orchestrator-manager-svc" "capacity-planner-svc" "network-analytics-svc" "marketplace-svc" "community-svc")
  
  for service in "${services[@]}"; do
    run_seed "$service" || true
  done
  
  log_success "All seeding completed!"
else
  # Run seed for specific service
  run_seed "$SERVICE" "$RESET"
fi
