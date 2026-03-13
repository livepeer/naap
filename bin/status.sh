#!/bin/bash
#
# NAAP Platform - Status & Utility Script (Development Tooling)
#
# Replaces start.sh for status, validate, list, logs.
# Reads ports from .dev-ports.json when available (written by dev-runner).
#
# Usage:
#   ./bin/status.sh status    Show running services
#   ./bin/status.sh validate  Health-check all services
#   ./bin/status.sh list      List available plugins
#   ./bin/status.sh logs [svc]  Tail logs (legacy; with npm run dev, logs go to terminal)
#

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PORTS_FILE="$ROOT_DIR/.dev-ports.json"
LOG_DIR="$ROOT_DIR/logs"

# Default ports (used when .dev-ports.json doesn't exist)
SHELL_PORT=3000
BASE_SVC_PORT=4000
PLUGIN_SERVER_PORT=3100

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

# Load ports from .dev-ports.json if present
load_ports() {
  if [ -f "$PORTS_FILE" ]; then
    SHELL_PORT=$(grep -o '"shell"[[:space:]]*:[[:space:]]*[0-9]*' "$PORTS_FILE" | grep -o '[0-9]*')
    BASE_SVC_PORT=$(grep -o '"base"[[:space:]]*:[[:space:]]*[0-9]*' "$PORTS_FILE" | grep -o '[0-9]*')
    PLUGIN_SERVER_PORT=$(grep -o '"pluginServer"[[:space:]]*:[[:space:]]*[0-9]*' "$PORTS_FILE" | grep -o '[0-9]*')
    [ -z "$SHELL_PORT" ] && SHELL_PORT=3000
    [ -z "$BASE_SVC_PORT" ] && BASE_SVC_PORT=4000
    [ -z "$PLUGIN_SERVER_PORT" ] && PLUGIN_SERVER_PORT=3100
  fi
}

check_health() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$1" --connect-timeout 3 2>/dev/null) || true
  echo "${code:-000}"
}

get_all_plugins() {
  local plugins=()
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local name
    name=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    plugins+=("$name")
  done
  echo "${plugins[@]}"
}

get_plugin_backend_port() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  [ -f "$pj" ] && grep -A5 '"backend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
}

get_plugin_health_path() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$pj" ]; then
    local hp
    hp=$(grep -o '"healthCheck"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    echo "${hp:-/healthz}"
  else echo "/healthz"; fi
}

get_plugin_display_name() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$pj" ]; then
    grep -o '"displayName"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  else echo "$1"; fi
}

print_svc_status() {
  local svc=$1 dn=$2 port=$3 url=$4
  local ps="${DIM}--${NC}" hs=""
  if [ -n "$url" ]; then
    local sc=$(check_health "$url")
    case "$sc" in
      200) hs="${GREEN}healthy${NC}" ;;
      000) hs="${DIM}stopped${NC}" ;;
      *)   hs="${YELLOW}HTTP $sc${NC}" ;;
    esac
  else
    hs="${DIM}N/A${NC}"
  fi
  nc -z localhost "$port" 2>/dev/null && ps="$port" || ps="${DIM}$port${NC}"
  printf "  %-25s %-8s %b\n" "$dn" "$ps" "$hs"
}

cmd_status() {
  load_ports
  echo ""
  echo -e "${BOLD}NAAP Platform Status${NC}"
  echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo ""
  printf "  ${BOLD}%-25s %-8s %-10s${NC}\n" "SERVICE" "PORT" "HEALTH"
  printf "  %-25s %-8s %-10s\n" "-------------------------" "--------" "----------"
  print_svc_status "shell" "Shell" "$SHELL_PORT" "http://localhost:$SHELL_PORT"
  print_svc_status "base-svc" "Base Service" "$BASE_SVC_PORT" "http://localhost:$BASE_SVC_PORT/healthz"
  print_svc_status "plugin-server" "Plugin Server" "$PLUGIN_SERVER_PORT" "http://localhost:$PLUGIN_SERVER_PORT/healthz"
  echo ""
  printf "  ${BOLD}%-25s${NC}\n" "PLUGIN BACKENDS"
  printf "  %-25s %-8s %-10s\n" "-------------------------" "--------" "----------"
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    [ -z "$bp" ] && continue
    local hp=$(get_plugin_health_path "$plugin")
    print_svc_status "${plugin}-svc" "$(get_plugin_display_name "$plugin")" "$bp" "http://localhost:$bp${hp}"
  done
  echo ""
  if docker info >/dev/null 2>&1; then
    local cnt=$(docker ps --filter "name=naap-" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${BOLD}Infrastructure:${NC} $cnt Docker container(s)"
    [ "$cnt" -gt 0 ] && docker ps --filter "name=naap-" --format "    {{.Names}} ({{.Status}})" 2>/dev/null
  else
    echo -e "  ${BOLD}Infrastructure:${NC} ${DIM}Docker not running${NC}"
  fi
  echo ""
}

cmd_validate() {
  load_ports
  echo ""
  echo -e "${BOLD}NAAP Platform Validation${NC}"
  echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo ""
  local passed=0 failed=0 skipped=0

  _vld() {
    local code=$(check_health "$2")
    case "$code" in
      200) echo -e "  ${GREEN}[PASS]${NC} $1"; ((passed++)) || true ;;
      000) echo -e "  ${YELLOW}[SKIP]${NC} $1 (not running)"; ((skipped++)) || true ;;
      *)   echo -e "  ${RED}[FAIL]${NC} $1 (HTTP $code)"; ((failed++)) || true ;;
    esac
  }

  log_section "Core Services"
  _vld "Shell" "http://localhost:$SHELL_PORT"
  _vld "Base Service" "http://localhost:$BASE_SVC_PORT/healthz"
  _vld "Plugin Server" "http://localhost:$PLUGIN_SERVER_PORT/healthz"

  log_section "Plugin Backends"
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    [ -z "$bp" ] && continue
    local hp=$(get_plugin_health_path "$plugin")
    _vld "$(get_plugin_display_name "$plugin") Backend" "http://localhost:$bp${hp}"
  done

  echo ""
  echo "================================================"
  echo -e "${BOLD}Results${NC}: ${GREEN}$passed passed${NC}, ${YELLOW}$skipped skipped${NC}, ${RED}$failed failed${NC}"
  echo "================================================"
  [ "$failed" -gt 0 ] && exit 1 || exit 0
}

cmd_list() {
  echo ""
  echo -e "${BOLD}Available Plugins${NC}"
  echo ""
  printf "  ${BOLD}%-25s %-12s %-12s${NC}\n" "NAME" "FRONTEND" "BACKEND"
  printf "  %-25s %-12s %-12s\n" "-------------------------" "------------" "------------"
  for p in $(get_all_plugins); do
    local dn=$(get_plugin_display_name "$p")
    local fp="" bp
    [ -f "$ROOT_DIR/plugins/$p/frontend/package.json" ] && fp="dev"
    bp=$(get_plugin_backend_port "$p")
    printf "  %-25s %-12s %-12s\n" "$dn" "${fp:-N/A}" "${bp:-N/A}"
  done
  echo ""
}

cmd_logs() {
  local svc=$1
  if [ -z "$svc" ]; then
    echo "With npm run dev, logs go to the terminal."
    echo ""
    echo "Available log files (if using legacy start.sh):"
    ls -1 "$LOG_DIR"/*.log 2>/dev/null | while read -r f; do echo "  $(basename "$f" .log)"; done
    echo ""
    echo "Usage: ./bin/status.sh logs <name>"
    return
  fi
  local lf="$LOG_DIR/${svc}.log"
  [ ! -f "$lf" ] && lf="$LOG_DIR/${svc}-svc.log"
  [ ! -f "$lf" ] && lf="$LOG_DIR/${svc}-web.log"
  if [ -f "$lf" ]; then
    log_info "Tailing $lf (Ctrl+C to stop)"
    tail -f "$lf"
  else
    log_error "No log found for: $svc"
    log_info "With npm run dev, all logs go to the terminal."
  fi
}

###############################################################################
# MAIN
###############################################################################

SUB="${1:-status}"
case "$SUB" in
  status)  cmd_status ;;
  validate) cmd_validate ;;
  list)    cmd_list ;;
  logs)    cmd_logs "${2:-}" ;;
  -h|--help|help)
    echo ""
    echo -e "${BOLD}NAAP Platform — Status${NC}"
    echo ""
    echo "Usage: ./bin/status.sh [command]"
    echo ""
    echo "Commands:"
    echo "  status    Show running services and health"
    echo "  validate  Health-check all services"
    echo "  list      List available plugins"
    echo "  logs [svc] Tail logs (legacy)"
    echo ""
    ;;
  *)
    log_error "Unknown command: $SUB"
    echo "Usage: ./bin/status.sh status|validate|list|logs"
    exit 1
    ;;
esac
