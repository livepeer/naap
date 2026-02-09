#!/bin/bash

# NAAP Platform - Database Reset Script
# Drops and recreates database for a specific service or all services

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

reset_database() {
  local service=$1
  local service_path=$(get_service_path "$service")
  
  if [ ! -f "$service_path/prisma/schema.prisma" ]; then
    log_warn "No Prisma schema found for $service, skipping..."
    return
  fi
  
  log_warn "Resetting database for $service (this will delete all data)..."
  read -p "Are you sure? (yes/no): " confirm
  
  if [ "$confirm" != "yes" ]; then
    log_info "Reset cancelled"
    return
  fi
  
  log_info "Resetting $service database..."
  cd "$service_path"
  
  if npx prisma migrate reset --force; then
    log_success "Database reset completed for $service"
  else
    log_error "Database reset failed for $service"
    return 1
  fi
  
  cd "$ROOT_DIR"
}

if [ -z "$SERVICE" ]; then
  # Reset all services
  log_warn "This will reset ALL databases. Are you sure?"
  read -p "Type 'yes' to continue: " confirm
  
  if [ "$confirm" != "yes" ]; then
    log_info "Reset cancelled"
    exit 0
  fi
  
  log_info "Resetting all databases..."
  
  services=("base-svc" "gateway-manager-svc" "orchestrator-manager-svc" "capacity-planner-svc" "network-analytics-svc" "marketplace-svc" "community-svc")
  
  for service in "${services[@]}"; do
    reset_database "$service" || true
  done
  
  log_success "All databases reset!"
else
  # Reset specific service
  reset_database "$SERVICE"
fi
