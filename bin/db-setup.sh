#!/bin/bash

# NAAP Platform - Unified Database Setup Script
# Sets up the single PostgreSQL container with multi-schema architecture.
#
# Usage:
#   ./bin/db-setup.sh          # Start DB, generate client, push schema
#   ./bin/db-setup.sh --reset  # Destroy DB volume and recreate

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cd "$ROOT_DIR"

# ── Handle --reset flag ─────────────────────────────────────
if [ "$1" = "--reset" ]; then
  log_warn "Resetting database (destroying all data)..."
  docker-compose down -v 2>/dev/null || true
fi

# ── 1. Start unified database container ─────────────────────
log_info "Starting unified database..."
docker-compose up -d database

log_info "Waiting for database to be ready..."
for i in $(seq 1 30); do
  docker exec naap-db pg_isready -U postgres > /dev/null 2>&1 && break
  printf "."
  sleep 1
done
echo ""
docker exec naap-db pg_isready -U postgres > /dev/null 2>&1 || { log_error "Database failed to start"; exit 1; }
log_success "Unified database ready"

# ── 2. Generate Prisma client ───────────────────────────────
log_info "Generating Prisma client from unified schema..."
cd "$ROOT_DIR/packages/database"
npx prisma generate
log_success "Prisma client generated"

# ── 3. Push schema to database ──────────────────────────────
log_info "Pushing schema to database (creates all tables in all schemas)..."
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" npx prisma db push --accept-data-loss
log_success "Schema pushed to database"

# ── 4. Verify schemas ──────────────────────────────────────
log_info "Verifying schemas..."
SCHEMAS=("public" "plugin_community" "plugin_wallet" "plugin_dashboard" "plugin_daydream" "plugin_gateway" "plugin_capacity" "plugin_developer_api")
for schema in "${SCHEMAS[@]}"; do
  tc=$(docker exec naap-db psql -U postgres -d naap -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='$schema'" 2>/dev/null | tr -d ' ')
  if [ -n "$tc" ] && [ "$tc" -gt 0 ]; then
    log_success "  $schema: $tc tables"
  else
    log_warn "  $schema: no tables"
  fi
done

# ── 5. Seed (optional) ─────────────────────────────────────
if [ -f "$ROOT_DIR/packages/database/prisma/seed.ts" ]; then
  log_info "Seeding database..."
  cd "$ROOT_DIR/packages/database"
  npx tsx prisma/seed.ts 2>/dev/null && log_success "Database seeded" || log_warn "Seeding had issues (non-critical)"
fi

echo ""
log_success "Database setup complete!"
echo "  Connection: postgresql://postgres:postgres@localhost:5432/naap"
echo "  Prisma Studio: cd packages/database && npx prisma studio"
