#!/bin/bash

# NAAP Platform - Stop Script (Development Tooling)
# ==================================================
# Clean shutdown of all NAAP development services.
# This is a standalone script — no dependency on start.sh.
#
# Usage:
#   ./bin/stop.sh              Stop all NAAP services
#   ./bin/stop.sh <plugin>     Stop a specific plugin
#   ./bin/stop.sh --infra      Also stop Docker containers
#   ./bin/stop.sh --help       Show this help
#
# Note: This is development tooling. Not for production use.

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$ROOT_DIR/.pids"
GRACEFUL_TIMEOUT="${GRACEFUL_TIMEOUT:-5}"

# Core service ports
SHELL_PORT=3000
BASE_SVC_PORT=4000
PLUGIN_SERVER_PORT=3100

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

###############################################################################
# PORT DISCOVERY
###############################################################################

# Discover all plugin ports from plugin.json files (backend + frontend dev)
get_all_plugin_ports() {
  local ports=()
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local bp fp
    bp=$(grep -A5 '"backend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')
    fp=$(grep -B2 -A5 '"frontend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')
    [ -n "$bp" ] && ports+=("$bp")
    [ -n "$fp" ] && ports+=("$fp")
  done
  echo "${ports[@]}"
}

###############################################################################
# STOP ALL
###############################################################################

stop_all() {
  echo ""
  log_info "Stopping all NAAP Platform services..."
  local killed=0

  # Phase 1: Kill tracked PIDs from .pids file
  if [ -f "$PID_FILE" ] && [ -s "$PID_FILE" ]; then
    local all_pids=() all_names=()
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local pid name
      pid=$(echo "$line" | cut -d' ' -f1)
      name=$(echo "$line" | cut -d' ' -f2-)
      kill -0 "$pid" 2>/dev/null || continue
      all_pids+=("$pid")
      all_names+=("$name")
    done < "$PID_FILE"

    local count=${#all_pids[@]}
    if [ $count -gt 0 ]; then
      log_info "Sending SIGTERM to $count tracked service(s)..."

      # Send SIGTERM to all at once (parallel shutdown)
      for pid in "${all_pids[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
      done

      # Wait for graceful shutdown
      local wait_s=0 alive=$count
      while [ $wait_s -lt $GRACEFUL_TIMEOUT ] && [ $alive -gt 0 ]; do
        sleep 1
        ((wait_s++))
        alive=0
        for i in "${!all_pids[@]}"; do
          [ -z "${all_pids[$i]}" ] && continue
          if ! kill -0 "${all_pids[$i]}" 2>/dev/null; then
            log_success "Stopped ${all_names[$i]} ${DIM}(PID ${all_pids[$i]}, ${wait_s}s)${NC}"
            all_pids[$i]=""
            ((killed++))
          else
            ((alive++))
          fi
        done
      done

      # Force-kill any survivors
      for i in "${!all_pids[@]}"; do
        [ -z "${all_pids[$i]}" ] && continue
        log_warn "Force-killing ${all_names[$i]} (PID ${all_pids[$i]})"
        kill -9 "${all_pids[$i]}" 2>/dev/null || true
        ((killed++))
      done
    fi
  fi

  # Phase 2: Kill orphans by port scanning (catches processes not tracked in .pids)
  log_info "Scanning ports for orphaned processes..."
  local all_ports="$SHELL_PORT $PLUGIN_SERVER_PORT $BASE_SVC_PORT"
  for port in $(get_all_plugin_ports); do
    all_ports="$all_ports $port"
  done
  for port in $all_ports; do
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    for op in $pids; do
      [ -z "$op" ] && continue
      log_info "Killing orphan on port $port (PID $op)"
      kill -TERM "$op" 2>/dev/null || true
      ((killed++))
    done
  done

  # Clear PID file
  : > "$PID_FILE" 2>/dev/null || true

  echo ""
  if [ $killed -gt 0 ]; then
    log_success "All NAAP Platform services stopped ($killed process(es) terminated)"
  else
    log_info "No NAAP services were running"
  fi
}

###############################################################################
# STOP SPECIFIC PLUGIN
###############################################################################

stop_plugin() {
  local name=$1
  [ ! -d "$ROOT_DIR/plugins/$name" ] && { log_error "Plugin not found: $name"; return 1; }

  local stopped=false

  # Kill by PID from .pids file
  if [ -f "$PID_FILE" ]; then
    for suffix in "-svc" "-web"; do
      local svc_name="${name}${suffix}"
      local pid
      pid=$(grep " ${svc_name}$" "$PID_FILE" 2>/dev/null | tail -1 | cut -d' ' -f1)
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        log_success "Stopped ${svc_name} (PID $pid)"
        stopped=true
      fi
      # Remove from PID file
      if [ -f "$PID_FILE" ]; then
        local tmp="${PID_FILE}.tmp.$$"
        grep -v " ${svc_name}$" "$PID_FILE" > "$tmp" 2>/dev/null || true
        mv "$tmp" "$PID_FILE"
      fi
    done
  fi

  # Kill by port (safety net for orphaned processes)
  local pj="$ROOT_DIR/plugins/$name/plugin.json"
  if [ -f "$pj" ]; then
    local bp fp
    bp=$(grep -A5 '"backend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')
    fp=$(grep -B2 -A5 '"frontend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*')
    for port in $bp $fp; do
      [ -z "$port" ] && continue
      local pids
      pids=$(lsof -ti:"$port" 2>/dev/null || true)
      for op in $pids; do
        [ -z "$op" ] && continue
        kill -TERM "$op" 2>/dev/null || true
        stopped=true
      done
    done
  fi

  [ "$stopped" = true ] && log_success "Plugin $name stopped" || log_info "Plugin $name was not running"
}

###############################################################################
# STOP INFRASTRUCTURE (Docker)
###############################################################################

stop_infra() {
  log_info "Stopping Docker containers..."
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    cd "$ROOT_DIR" || true
    docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
    log_success "Docker containers stopped"
  else
    log_warn "Docker not available"
  fi
}

###############################################################################
# HELP
###############################################################################

show_help() {
  echo ""
  echo -e "${BOLD}NAAP Platform — Stop${NC} ${DIM}(Development Tooling)${NC}"
  echo ""
  echo "Usage: ./bin/stop.sh [options]"
  echo ""
  echo "  (no options)     Stop all NAAP services (graceful + port cleanup)"
  echo "  <plugin> ...     Stop specific plugin(s)"
  echo "  --infra          Stop all services + Docker containers"
  echo "  --help           Show this help"
  echo ""
  echo "Environment:"
  echo "  GRACEFUL_TIMEOUT=N   Seconds before force-kill (default: 5)"
  echo ""
  echo -e "${DIM}Note: This is development tooling. Not for production use.${NC}"
  echo ""
}

###############################################################################
# MAIN
###############################################################################

case "${1:-}" in
  --infra)
    stop_all
    stop_infra
    ;;
  --help|-h|help)
    show_help
    ;;
  "")
    stop_all
    ;;
  *)
    # Stop specific plugins
    for p in "$@"; do
      if [ -d "$ROOT_DIR/plugins/$p" ]; then
        stop_plugin "$p"
      else
        log_error "Unknown plugin: $p"
      fi
    done
    ;;
esac
