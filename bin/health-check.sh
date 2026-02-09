#!/bin/bash
# =============================================================================
# NAAP Platform - Health Check Script
# =============================================================================
#
# Checks the health of all NAAP services and reports status.
# Compatible with bash 3.2+ (macOS default)
#
# Usage:
#   ./bin/health-check.sh           # Check all services
#   ./bin/health-check.sh base-svc  # Check specific service
#   ./bin/health-check.sh --json    # JSON output
#   ./bin/health-check.sh --verbose # Detailed output
#
# Exit codes:
#   0 - All services healthy
#   1 - One or more services unhealthy
#   2 - Configuration error
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TIMEOUT=5
VERBOSE=false
JSON_OUTPUT=false
SPECIFIC_SERVICE=""

# Results
TOTAL_HEALTHY=0
TOTAL_UNHEALTHY=0
RESULTS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --timeout)
      TIMEOUT=$2
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [options] [service-name]"
      echo ""
      echo "Options:"
      echo "  --json        Output in JSON format"
      echo "  --verbose,-v  Show detailed output"
      echo "  --timeout N   Request timeout in seconds (default: 5)"
      echo "  --help,-h     Show this help"
      echo ""
      echo "Services:"
      echo "  vercel, base-svc, plugin-server, livepeer-svc, pipeline-gateway,"
      echo "  storage-svc, infrastructure-svc, gateway-manager, orchestrator-manager,"
      echo "  capacity-planner, network-analytics, marketplace, community,"
      echo "  my-wallet, my-dashboard, daydream-video, developer-api, plugin-publisher"
      exit 0
      ;;
    *)
      SPECIFIC_SERVICE=$1
      shift
      ;;
  esac
done

# Service definitions (name|url|endpoint)
get_service_url() {
  local name=$1
  case $name in
    vercel)
      echo "${NEXT_PUBLIC_APP_URL:-http://localhost:3000}|/api/health"
      ;;
    base-svc)
      echo "${BASE_SVC_URL:-http://localhost:4000}|/healthz"
      ;;
    plugin-server)
      echo "${PLUGIN_SERVER_URL:-http://localhost:3100}|/healthz"
      ;;
    livepeer-svc)
      echo "${LIVEPEER_SVC_URL:-http://localhost:4010}|/healthz"
      ;;
    pipeline-gateway)
      echo "${PIPELINE_GATEWAY_URL:-http://localhost:4020}|/healthz"
      ;;
    storage-svc)
      echo "${STORAGE_SVC_URL:-http://localhost:4050}|/healthz"
      ;;
    infrastructure-svc)
      echo "${INFRASTRUCTURE_SVC_URL:-http://localhost:4060}|/healthz"
      ;;
    gateway-manager)
      echo "${GATEWAY_MANAGER_URL:-http://localhost:4001}|/healthz"
      ;;
    orchestrator-manager)
      echo "${ORCHESTRATOR_MANAGER_URL:-http://localhost:4002}|/healthz"
      ;;
    capacity-planner)
      echo "${CAPACITY_PLANNER_URL:-http://localhost:4003}|/healthz"
      ;;
    network-analytics)
      echo "${NETWORK_ANALYTICS_URL:-http://localhost:4004}|/healthz"
      ;;
    marketplace)
      echo "${MARKETPLACE_URL:-http://localhost:4005}|/healthz"
      ;;
    community)
      echo "${COMMUNITY_URL:-http://localhost:4006}|/healthz"
      ;;
    my-wallet)
      echo "${WALLET_URL:-http://localhost:4007}|/healthz"
      ;;
    my-dashboard)
      echo "${DASHBOARD_URL:-http://localhost:4008}|/healthz"
      ;;
    daydream-video)
      echo "${DAYDREAM_VIDEO_URL:-http://localhost:4009}|/healthz"
      ;;
    developer-api)
      echo "${DEVELOPER_API_URL:-http://localhost:4011}|/healthz"
      ;;
    plugin-publisher)
      echo "${PLUGIN_PUBLISHER_URL:-http://localhost:4012}|/healthz"
      ;;
    *)
      echo ""
      ;;
  esac
}

# All services list
ALL_SERVICES="vercel base-svc plugin-server livepeer-svc pipeline-gateway storage-svc infrastructure-svc gateway-manager orchestrator-manager capacity-planner network-analytics marketplace community my-wallet my-dashboard daydream-video developer-api plugin-publisher"

# Check a single service
check_service() {
  local name=$1
  local url_endpoint
  url_endpoint=$(get_service_url "$name")

  if [[ -z "$url_endpoint" ]]; then
    echo "$name|error|0|Unknown service"
    return 1
  fi

  local base_url="${url_endpoint%|*}"
  local endpoint="${url_endpoint#*|}"
  local full_url="${base_url}${endpoint}"

  if $VERBOSE; then
    echo -e "${BLUE}Checking ${name}...${NC} ${full_url}" >&2
  fi

  local start_time
  local end_time
  local latency
  local http_code
  local status
  local message

  start_time=$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || date +%s)

  # Make HTTP request
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT" "$full_url" 2>/dev/null) || http_code="000"

  end_time=$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || date +%s)

  # Calculate latency (rough estimate if python not available)
  if [[ "$start_time" -gt 1000000000000 ]]; then
    latency=$((end_time - start_time))
  else
    latency=$((( end_time - start_time ) * 1000))
  fi

  if [[ "$http_code" == "200" ]]; then
    status="healthy"
    message="OK"
    TOTAL_HEALTHY=$((TOTAL_HEALTHY + 1))
  elif [[ "$http_code" == "503" ]]; then
    status="degraded"
    message="Service degraded"
    TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
  elif [[ "$http_code" == "000" ]]; then
    status="unhealthy"
    message="Connection refused"
    latency=0
    TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
  else
    status="unhealthy"
    message="HTTP $http_code"
    TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
  fi

  echo "$name|$status|$latency|$message"
}

# Print results in table format
print_table() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  echo "║                    NAAP Platform Health Status                        ║"
  echo "╠══════════════════════════════════════════════════════════════════════╣"
  printf "║ %-24s %-12s %-10s %-18s ║\n" "Service" "Status" "Latency" "Message"
  echo "╠══════════════════════════════════════════════════════════════════════╣"

  # Core services
  for result in $RESULTS; do
    local name="${result%%|*}"
    case $name in
      vercel|base-svc|plugin-server|livepeer-svc|pipeline-gateway|storage-svc|infrastructure-svc)
        print_row "$result"
        ;;
    esac
  done

  echo "╠──────────────────────────────────────────────────────────────────────╣"

  # Plugin backends
  for result in $RESULTS; do
    local name="${result%%|*}"
    case $name in
      gateway-manager|orchestrator-manager|capacity-planner|network-analytics|marketplace|community|my-wallet|my-dashboard|daydream-video|developer-api|plugin-publisher)
        print_row "$result"
        ;;
    esac
  done

  echo "╠══════════════════════════════════════════════════════════════════════╣"
  printf "║ %-24s " "Total:"
  echo -e "${GREEN}${TOTAL_HEALTHY} healthy${NC} / ${RED}${TOTAL_UNHEALTHY} unhealthy${NC}                    ║"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo ""
}

print_row() {
  local result=$1
  local name="${result%%|*}"
  local rest="${result#*|}"
  local status="${rest%%|*}"
  rest="${rest#*|}"
  local latency="${rest%%|*}"
  local message="${rest#*|}"

  local status_color
  local status_icon
  case $status in
    healthy)
      status_color=$GREEN
      status_icon="✓"
      ;;
    degraded)
      status_color=$YELLOW
      status_icon="!"
      ;;
    unhealthy)
      status_color=$RED
      status_icon="✗"
      ;;
    *)
      status_color=$RED
      status_icon="?"
      ;;
  esac

  local latency_str
  if [[ "$latency" -gt 0 ]]; then
    latency_str="${latency}ms"
  else
    latency_str="-"
  fi

  printf "║ %-24s ${status_color}%-12s${NC} %-10s %-18s ║\n" \
    "$name" "${status_icon} ${status}" "$latency_str" "${message:0:18}"
}

# Print results in JSON format
print_json() {
  echo "{"
  echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"summary\": {"
  echo "    \"total\": $((TOTAL_HEALTHY + TOTAL_UNHEALTHY)),"
  echo "    \"healthy\": $TOTAL_HEALTHY,"
  echo "    \"unhealthy\": $TOTAL_UNHEALTHY"
  echo "  },"
  echo "  \"services\": {"

  local first=true
  for result in $RESULTS; do
    if ! $first; then
      echo ","
    fi
    first=false

    local name="${result%%|*}"
    local rest="${result#*|}"
    local status="${rest%%|*}"
    rest="${rest#*|}"
    local latency="${rest%%|*}"
    local message="${rest#*|}"

    printf "    \"%s\": {\n" "$name"
    printf "      \"status\": \"%s\",\n" "$status"
    printf "      \"latency_ms\": %d,\n" "$latency"
    printf "      \"message\": \"%s\"\n" "$message"
    printf "    }"
  done

  echo ""
  echo "  }"
  echo "}"
}

# Count results from stored data
count_results() {
  TOTAL_HEALTHY=0
  TOTAL_UNHEALTHY=0

  echo "$RESULTS" | while IFS='|' read -r name status latency message; do
    if [[ "$status" == "healthy" ]]; then
      echo "healthy"
    else
      echo "unhealthy"
    fi
  done | while read line; do
    if [[ "$line" == "healthy" ]]; then
      TOTAL_HEALTHY=$((TOTAL_HEALTHY + 1))
    else
      TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
    fi
  done

  # Recount from results
  for result in $RESULTS; do
    local status
    local rest="${result#*|}"
    status="${rest%%|*}"
    if [[ "$status" == "healthy" ]]; then
      TOTAL_HEALTHY=$((TOTAL_HEALTHY + 1))
    else
      TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
    fi
  done
}

# Main execution
main() {
  if [[ -n "$SPECIFIC_SERVICE" ]]; then
    # Check specific service
    local url_endpoint
    url_endpoint=$(get_service_url "$SPECIFIC_SERVICE")
    if [[ -z "$url_endpoint" ]]; then
      echo -e "${RED}Error: Unknown service '$SPECIFIC_SERVICE'${NC}"
      echo "Run '$0 --help' for available services"
      exit 2
    fi
    RESULTS=$(check_service "$SPECIFIC_SERVICE")
  else
    # Check all services
    for service in $ALL_SERVICES; do
      result=$(check_service "$service")
      if [[ -n "$RESULTS" ]]; then
        RESULTS="$RESULTS
$result"
      else
        RESULTS="$result"
      fi
    done
  fi

  # Count healthy/unhealthy from results
  TOTAL_HEALTHY=0
  TOTAL_UNHEALTHY=0
  while IFS= read -r result; do
    local rest="${result#*|}"
    local status="${rest%%|*}"
    if [[ "$status" == "healthy" ]]; then
      TOTAL_HEALTHY=$((TOTAL_HEALTHY + 1))
    else
      TOTAL_UNHEALTHY=$((TOTAL_UNHEALTHY + 1))
    fi
  done <<< "$RESULTS"

  # Output results
  if $JSON_OUTPUT; then
    print_json
  else
    print_table
  fi

  # Exit with appropriate code
  if [[ $TOTAL_UNHEALTHY -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main
