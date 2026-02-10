#!/bin/bash

# ╔════════════════════════════════════════════════════════════════╗
# ║  DEPRECATED — This script starts the old multi-database and   ║
# ║  Kafka infrastructure that is no longer used.                  ║
# ║                                                                ║
# ║  NaaP now uses a single PostgreSQL container. Kafka is not     ║
# ║  part of the current architecture.                             ║
# ║                                                                ║
# ║  Use instead:                                                  ║
# ║    ./bin/setup.sh        # Full setup including DB             ║
# ║    ./bin/start.sh        # Start the platform                  ║
# ╚════════════════════════════════════════════════════════════════╝

echo "WARNING: This script is DEPRECATED."
echo "NaaP now uses a single PostgreSQL database. Use:"
echo "  ./bin/setup.sh   (initial setup)"
echo "  ./bin/start.sh   (start platform)"
exit 1

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

cd "$ROOT_DIR"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  log_error "Docker is not running. Please start Docker and try again."
  exit 1
fi

# Start databases
log_info "Starting database containers..."
docker-compose up -d base-db gateway-db orchestrator-db capacity-db analytics-db marketplace-db community-db

# Wait for databases to be ready
log_info "Waiting for databases to be ready..."
for db in base-db gateway-db orchestrator-db capacity-db analytics-db marketplace-db community-db; do
  log_info "Waiting for $db..."
  timeout=60
  elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if docker-compose exec -T $db pg_isready -U naap_${db%-db} > /dev/null 2>&1; then
      log_success "$db is ready"
      break
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  
  if [ $elapsed -ge $timeout ]; then
    log_error "$db failed to become ready"
    exit 1
  fi
done

# Start Kafka
log_info "Starting Kafka infrastructure..."
docker-compose up -d zookeeper kafka

# Wait for Kafka to be ready
log_info "Waiting for Kafka to be ready..."
timeout=60
elapsed=0
while [ $elapsed -lt $timeout ]; do
  if docker-compose exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null 2>&1; then
    log_success "Kafka is ready"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge $timeout ]; then
  log_warn "Kafka may not be fully ready, but continuing..."
fi

log_success "All infrastructure services started!"
echo ""
echo "Services:"
echo "  Databases: Running on ports 5432-5438"
echo "  Kafka:     Running on port 9092"
echo "  Zookeeper: Running on port 2181"
echo ""
echo "To stop all services: docker-compose down"
echo "To view logs: docker-compose logs -f"
