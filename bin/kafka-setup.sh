#!/bin/bash

# NAAP Platform - Kafka Topic Setup Script
# Creates Kafka topics and configures consumer groups

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

# Check if Kafka is running
if ! docker-compose ps kafka | grep -q "Up"; then
  log_error "Kafka is not running. Please start it first with: ./bin/services-start.sh"
  exit 1
fi

log_info "Setting up Kafka topics..."

# Define topics to create
# Format: topic_name:partitions:replication_factor
topics=(
  "gateway.job.created:3:1"
  "gateway.job.completed:3:1"
  "gateway.job.failed:3:1"
  "gateway.job.processing:3:1"
  "orchestrator.status:2:1"
  "orchestrator.metrics:2:1"
  "network.events:1:1"
)

# Create topics
for topic_config in "${topics[@]}"; do
  IFS=':' read -r topic partitions replication <<< "$topic_config"
  
  log_info "Creating topic: $topic (partitions: $partitions, replication: $replication)"
  
  if docker-compose exec -T kafka kafka-topics --create \
    --bootstrap-server localhost:9092 \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor "$replication" \
    --if-not-exists 2>/dev/null; then
    log_success "Topic $topic created"
  else
    log_warn "Topic $topic may already exist or creation failed"
  fi
done

# List all topics
log_info "Listing all topics..."
docker-compose exec -T kafka kafka-topics --list --bootstrap-server localhost:9092

log_success "Kafka setup completed!"
echo ""
echo "Topics created:"
for topic_config in "${topics[@]}"; do
  IFS=':' read -r topic partitions replication <<< "$topic_config"
  echo "  - $topic ($partitions partitions, $replication replication factor)"
done
echo ""
echo "To view topic details: docker-compose exec kafka kafka-topics --describe --bootstrap-server localhost:9092 --topic <topic-name>"
