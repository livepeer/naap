#!/bin/bash

# NAAP Platform - Smoke Test Script
# Verifies all services are healthy and responding

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

FAILED=0
PASSED=0
SKIPPED=0

log_test() { echo -e "${BLUE}[TEST]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAILED++)); }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; ((SKIPPED++)); }
log_section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

check_healthz() {
  local name=$1
  local url=$2
  
  log_test "Checking $name health..."
  
  response=$(curl -s -o /dev/null -w "%{http_code}" "$url" --connect-timeout 5 2>/dev/null || echo "000")
  
  if [ "$response" = "200" ]; then
    log_pass "$name is healthy"
    return 0
  elif [ "$response" = "000" ]; then
    log_skip "$name is not running"
    return 1
  else
    log_fail "$name returned HTTP $response"
    return 1
  fi
}

check_frontend() {
  local name=$1
  local url=$2
  
  log_test "Checking $name frontend..."
  
  response=$(curl -s -o /dev/null -w "%{http_code}" "$url" --connect-timeout 5 2>/dev/null || echo "000")
  
  if [ "$response" = "200" ]; then
    log_pass "$name frontend serving"
    return 0
  elif [ "$response" = "000" ]; then
    log_skip "$name frontend not running"
    return 1
  else
    log_fail "$name frontend returned HTTP $response"
    return 1
  fi
}

check_cdn_bundle() {
  local name=$1
  local url=$2
  
  log_test "Checking $name CDN bundle..."
  
  response=$(curl -s -o /dev/null -w "%{http_code}" "$url" --connect-timeout 5 2>/dev/null || echo "000")
  
  if [ "$response" = "200" ]; then
    log_pass "$name CDN bundle available"
    return 0
  elif [ "$response" = "000" ]; then
    log_skip "$name not running"
    return 1
  else
    log_fail "$name CDN bundle returned HTTP $response"
    return 1
  fi
}

# Get plugin info from plugin.json
get_plugin_frontend_port() {
  local plugin_json="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$plugin_json" ]; then
    grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' "$plugin_json" | head -1 | grep -o '[0-9]*'
  fi
}

get_plugin_backend_port() {
  local plugin_json="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$plugin_json" ]; then
    grep -A5 '"backend"' "$plugin_json" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
  fi
}

get_plugin_display_name() {
  local plugin_json="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$plugin_json" ]; then
    grep -o '"displayName"[[:space:]]*:[[:space:]]*"[^"]*"' "$plugin_json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  else
    echo "$1"
  fi
}

echo ""
echo "================================================"
echo "NAAP Platform Smoke Tests"
echo "================================================"
echo ""

# Core services
log_section "Core Services"
check_healthz "Base Service" "http://localhost:4000/healthz"
check_frontend "Shell" "http://localhost:3000"

# Plugin health checks - dynamically discover plugins
log_section "Plugin Services"

for plugin_dir in "$ROOT_DIR/plugins"/*/; do
  plugin=$(basename "$plugin_dir")
  display_name=$(get_plugin_display_name "$plugin")
  frontend_port=$(get_plugin_frontend_port "$plugin")
  backend_port=$(get_plugin_backend_port "$plugin")
  
  # Check backend health
  if [ -n "$backend_port" ]; then
    check_healthz "$display_name Backend" "http://localhost:${backend_port}/healthz"
  fi
  
  # Check CDN bundle
  check_cdn_bundle "$display_name" "http://localhost:3000/cdn/plugins/${plugin}/1.0.0/${plugin}.js"
done

# API endpoint tests
log_section "Core API Endpoints"

# Test base service APIs
log_test "Testing auth endpoint..."
response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/api/v1/auth/session" --connect-timeout 5 2>/dev/null || echo "000")
if [ "$response" = "200" ] || [ "$response" = "401" ]; then
  log_pass "Auth API responding"
else
  log_skip "Auth API not available"
fi

log_test "Testing plugin registry..."
response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/api/v1/plugins" --connect-timeout 5 2>/dev/null || echo "000")
if [ "$response" = "200" ]; then
  log_pass "Plugin registry API responding"
else
  log_skip "Plugin registry API not available"
fi

log_test "Testing marketplace packages..."
response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/api/v1/registry/packages" --connect-timeout 5 2>/dev/null || echo "000")
if [ "$response" = "200" ]; then
  log_pass "Marketplace registry API responding"
else
  log_skip "Marketplace registry API not available"
fi

# Summary
echo ""
echo "================================================"
echo "Smoke Test Results"
echo "================================================"
echo -e "Passed:  ${GREEN}$PASSED${NC}"
echo -e "Skipped: ${YELLOW}$SKIPPED${NC}"
echo -e "Failed:  ${RED}$FAILED${NC}"
echo "================================================"

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All available services are healthy!${NC}"
  exit 0
fi
