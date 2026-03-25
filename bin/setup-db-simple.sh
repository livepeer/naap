#!/bin/bash

# NAAP Platform - Simple Database Setup
# One-command setup for the unified multi-schema database.
#
# Usage:
#   ./bin/setup-db-simple.sh          # Setup database
#   ./bin/setup-db-simple.sh --reset  # Reset and re-setup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== NAAP Unified Database Setup ==="
echo ""

cd "$ROOT_DIR"

# Resolve docker compose command: prefer v2 plugin, fall back to v1
docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "ERROR: Neither 'docker compose' (v2) nor 'docker-compose' (v1) found."
    exit 1
  fi
}

# Handle --reset
if [ "$1" = "--reset" ]; then
  echo "Resetting database..."
  docker_compose down -v 2>/dev/null || true
fi

# Start database
echo "Starting database..."
docker_compose up -d database
sleep 3

# Wait for ready
echo "Waiting for database..."
for i in $(seq 1 30); do
  docker exec naap-db pg_isready -U postgres > /dev/null 2>&1 && break
  sleep 1
done
docker exec naap-db pg_isready -U postgres > /dev/null 2>&1 || { echo "ERROR: Database not ready"; exit 1; }
echo "Database ready!"

# Generate + push
echo "Setting up schema..."
cd "$ROOT_DIR/packages/database"
npx prisma generate > /dev/null 2>&1
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" npx prisma db push --accept-data-loss > /dev/null 2>&1

echo ""
echo "=== Done ==="
echo "Connection: postgresql://postgres:postgres@localhost:5432/naap"
