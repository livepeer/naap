#!/bin/bash

# NAAP Platform Manager — Development Tooling
# =============================================
# This script is for LOCAL DEVELOPMENT only. Not for production deployment.
#
# Usage:
#   ./bin/start.sh                 Smart start (auto-detects your changed plugins)
#   ./bin/start.sh --all           Start everything
#   ./bin/start.sh <plugin> ...    Start shell + core + named plugins
#   ./bin/start.sh dev <plugin>    Full dev mode (frontend HMR + backend)
#   ./bin/start.sh status          Show running services
#   ./bin/start.sh help            Show all options
#
# Stop:
#   ./bin/stop.sh                  Stop all services
#   ./bin/stop.sh --infra          Also stop Docker containers

# Explicit error handling instead of set -e (more robust for complex scripts)
set +e
set +o pipefail 2>/dev/null || true

# Increase file descriptor limit (prevents EMFILE errors with many Node.js watchers)
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/logs"
LOCK_FILE="$ROOT_DIR/.naap.lock"

GRACEFUL_TIMEOUT="${GRACEFUL_TIMEOUT:-5}"
MAX_HEALTH_RETRIES=30
HEALTH_CHECK_INTERVAL=1
SHELL_PORT=3000
BASE_SVC_PORT=4000
PLUGIN_SERVER_PORT=3100
ARCHITECTURE_MODE=""
PARALLEL_START="${PARALLEL_START:-1}"  # 1=parallel (default), 0=sequential
CLEAN_NEXT="${CLEAN_NEXT:-0}"         # 1=delete .next cache before shell start
SKIP_VERIFY="${SKIP_VERIFY:-0}"       # 1=skip verify_all_plugins at end
SKIP_DB_SYNC="${SKIP_DB_SYNC:-0}"     # 1=skip prisma generate/push (trust existing state)
NO_PLUGINS="${NO_PLUGINS:-0}"         # 1=skip all plugin backends
ONLY_PLUGINS=""                       # comma-separated list of plugins to start (empty=all)
DEEP_CHECK="${DEEP_CHECK:-0}"         # 1=run deep health checks on backends
SHOW_TIMING="${SHOW_TIMING:-0}"       # 1=print per-phase timing at end

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
log_debug()   { [ "${DEBUG:-}" = "1" ] && echo -e "${DIM}[DEBUG] $1${NC}"; }

###############################################################################
# TIMING INSTRUMENTATION
###############################################################################

_T_PHASE=0; _T_NAMES=(); _T_DURS=()
_tstart() { _T_PHASE=$SECONDS; }
_tend()   { _T_NAMES+=("$1"); _T_DURS+=("$((SECONDS - _T_PHASE))"); }

_print_timing() {
  [ "$SHOW_TIMING" != "1" ] && return 0
  [ ${#_T_NAMES[@]} -eq 0 ] && return 0
  echo ""
  log_section "Timing Breakdown"
  local total=0
  for i in "${!_T_NAMES[@]}"; do
    printf "  %-30s %3ds\n" "${_T_NAMES[$i]}" "${_T_DURS[$i]}"
    total=$((total + _T_DURS[$i]))
  done
  printf "  %s\n" "──────────────────────────────────────"
  printf "  %-30s %3ds\n" "TOTAL" "$total"
}

###############################################################################
# PRE-FLIGHT CHECKS
###############################################################################

preflight_check() {
  local ok=true
  command -v node  >/dev/null 2>&1 || { log_error "node not found. Install Node.js 20+ from https://nodejs.org/"; ok=false; }
  command -v npm   >/dev/null 2>&1 || { log_error "npm not found. It comes with Node.js — reinstall from https://nodejs.org/"; ok=false; }
  command -v curl  >/dev/null 2>&1 || { log_error "curl not found. Install via your package manager (brew install curl / apt install curl)."; ok=false; }
  if [ "$ok" = false ]; then
    log_error "Pre-flight checks failed. Install missing dependencies and retry."
    exit 1
  fi

  # Check Node.js version (require 20+)
  local node_major
  node_major=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$node_major" -lt 20 ] 2>/dev/null; then
    log_error "Node.js v20+ required (found $(node -v)). Upgrade: nvm install 20"
    exit 1
  fi

  # Auto-detect first run: no node_modules means fresh clone.
  # All setup steps run inline — no separate setup.sh needed.
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    echo ""
    log_warn "node_modules not found — this looks like a fresh clone."
    log_info "Running first-time setup automatically..."
    echo ""
    log_section "First-Time Setup"

    # Step 1: Install dependencies
    log_info "Installing dependencies (npm install)... This may take 1-2 minutes."
    cd "$ROOT_DIR" || { log_error "Cannot cd to project root"; exit 1; }
    npm_log="$LOG_DIR/npm-install.log"
    npm install 2>&1 | tee "$npm_log"
    npm_exit=${PIPESTATUS[0]}
    if [ "$npm_exit" -ne 0 ]; then
      tail -30 "$npm_log"
      log_error "npm install failed (exit $npm_exit). Fix the errors above and retry."
      exit 1
    fi
    tail -5 "$npm_log"
    log_success "Dependencies installed"

    # Step 2: Install git hooks (pre-push validation)
    if [ -f "$SCRIPT_DIR/install-git-hooks.sh" ]; then
      bash "$SCRIPT_DIR/install-git-hooks.sh" 2>/dev/null && \
        log_success "Git hooks installed" || log_warn "Could not install git hooks"
    fi

    log_success "First-time setup complete. Continuing to start..."
    echo ""
  fi

  # Check Docker if we'll need databases
  if ! docker info >/dev/null 2>&1; then
    log_warn "Docker is not running. Database services will not be available."
    echo -e "  ${DIM}Fix: Start Docker Desktop, or run 'sudo systemctl start docker'${NC}"
  fi

  log_debug "Pre-flight checks passed (node: $(node -v), npm: $(npm -v))"
}

###############################################################################
# SIGNAL HANDLING & CLEANUP
###############################################################################

_STARTUP_PIDS=()  # Track PIDs launched during current session for cleanup

cleanup_on_signal() {
  echo ""
  log_warn "Interrupted! Cleaning up background processes..."
  # Kill any background jobs and their process groups started by this shell session
  for pid in "${_STARTUP_PIDS[@]}"; do
    kill_tree "$pid" TERM
  done
  jobs -p 2>/dev/null | xargs kill -TERM 2>/dev/null || true
  # Release lockfile
  rm -f "$LOCK_FILE" 2>/dev/null
  exit 130
}

trap cleanup_on_signal INT TERM

###############################################################################
# LOCKFILE (prevent concurrent starts)
###############################################################################

acquire_lock() {
  if [ -f "$LOCK_FILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      log_error "Another instance is running (PID $lock_pid). Wait or remove $LOCK_FILE"
      exit 1
    fi
    log_debug "Stale lockfile found, removing..."
    rm -f "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE"
}

release_lock() {
  rm -f "$LOCK_FILE" 2>/dev/null
}

###############################################################################
# PID MANAGEMENT
###############################################################################

register_pid() {
  local pid=$1 name=$2
  touch "$PID_FILE"
  # Use unique temp file (BASHPID+RANDOM) to avoid race conditions in parallel mode
  local uid="${BASHPID:-$$}.${RANDOM}"
  local tmp="${PID_FILE}.tmp.${uid}"
  (
    # Simple flock-style serialization using mkdir (atomic on all platforms)
    while ! mkdir "${PID_FILE}.lock" 2>/dev/null; do sleep 0.1; done
    grep -v " ${name}$" "$PID_FILE" > "$tmp" 2>/dev/null || true
    echo "$pid $name" >> "$tmp"
    mv "$tmp" "$PID_FILE"
    rmdir "${PID_FILE}.lock" 2>/dev/null
  )
  _STARTUP_PIDS+=("$pid")  # Track for signal cleanup
}

unregister_pid() {
  local name=$1
  if [ -f "$PID_FILE" ]; then
    local uid="${BASHPID:-$$}.${RANDOM}"
    local tmp="${PID_FILE}.tmp.${uid}"
    (
      while ! mkdir "${PID_FILE}.lock" 2>/dev/null; do sleep 0.1; done
      grep -v " ${name}$" "$PID_FILE" > "$tmp" 2>/dev/null || true
      mv "$tmp" "$PID_FILE"
      rmdir "${PID_FILE}.lock" 2>/dev/null
    )
  fi
}

get_pid() {
  local name=$1
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(grep " ${name}$" "$PID_FILE" 2>/dev/null | tail -1 | cut -d' ' -f1)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
    fi
  fi
}

is_running() {
  local pid
  pid=$(get_pid "$1")
  [ -n "$pid" ]
}

###############################################################################
# GRACEFUL PROCESS MANAGEMENT
###############################################################################

# Kill an entire process group (setsid-spawned) with fallback to single PID.
# When a process is spawned via setsid, its PID == PGID, so kill -- -$pid
# sends the signal to all children and grandchildren in the group.
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  kill -"$sig" -- -"$pid" 2>/dev/null || kill -"$sig" "$pid" 2>/dev/null || true
}

graceful_kill() {
  local pid=$1 name=$2 timeout=${3:-$GRACEFUL_TIMEOUT}

  if ! kill -0 "$pid" 2>/dev/null; then
    log_debug "$name (PID $pid) already stopped"
    return 0
  fi

  log_debug "Sending SIGTERM to $name (PID $pid) and its process group..."
  kill_tree "$pid" TERM

  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log_success "Stopped $name ${DIM}(PID $pid, graceful in ${elapsed}s)${NC}"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  log_warn "$name did not stop within ${timeout}s - force killing"
  kill_tree "$pid" 9
  sleep 1

  if ! kill -0 "$pid" 2>/dev/null; then
    log_success "Force-stopped $name (PID $pid)"
  else
    log_error "Failed to stop $name (PID $pid)"
    return 1
  fi
}

kill_port() {
  local port=$1 pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    [ -n "$pids" ] && { echo "$pids" | xargs kill -9 2>/dev/null || true; sleep 1; }
  fi
}

###############################################################################
# FAILURE DIAGNOSTICS
###############################################################################

show_failure_context() {
  local logfile=$1 lines=${2:-15}
  if [ -f "$logfile" ] && [ -s "$logfile" ]; then
    echo -e "  ${DIM}--- Last $lines lines of $(basename "$logfile") ---${NC}"
    tail -"$lines" "$logfile" 2>/dev/null | while IFS= read -r l; do echo -e "  ${DIM}  $l${NC}"; done
    echo -e "  ${DIM}--- End of log excerpt ---${NC}"
  fi
}

###############################################################################
# HEALTH CHECKING
###############################################################################

wait_for_health() {
  local url=$1 svc=$2 max=${3:-$MAX_HEALTH_RETRIES} intv=${4:-$HEALTH_CHECK_INTERVAL} mon_pid=${5:-}
  local delay="$intv"
  for i in $(seq 1 "$max"); do
    curl -sf --max-time 2 "$url" > /dev/null 2>&1 && return 0
    # If we're monitoring a pid and it died, fail immediately (don't wait full timeout)
    if [ -n "$mon_pid" ] && ! kill -0 "$mon_pid" 2>/dev/null; then
      log_debug "Process $mon_pid died while waiting for $svc"
      return 1
    fi
    # Progress every 5 attempts so user knows we're waiting (not hanging)
    if [ $((i % 5)) -eq 1 ] || [ "$i" -eq "$max" ]; then
      log_info "Waiting for $svc... ($i/$max)"
    else
      log_debug "Waiting for $svc... ($i/$max, next check in ${delay}s)"
    fi
    sleep "$delay"
    # Exponential backoff: 1s, 1s, 2s, 2s, 3s, 3s, ... capped at 5s
    delay=$(( (i / 2) + 1 ))
    [ "$delay" -gt 5 ] && delay=5
  done
  return 1
}

wait_for_port() {
  local port=$1 svc=$2 max=${3:-$MAX_HEALTH_RETRIES}
  for i in $(seq 1 "$max"); do
    nc -z localhost "$port" 2>/dev/null && return 0
    log_debug "Waiting for $svc on port $port... ($i/$max)"; sleep 1
  done
  return 1
}

check_health() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$1" --connect-timeout 3 2>/dev/null) || true
  echo "${code:-000}"
}

# Deep health check: verify a plugin backend can actually serve API requests
# (not just respond to /healthz). This catches database schema mismatches,
# missing tables, and Prisma client staleness that /healthz won't detect.
get_plugin_api_prefix() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$pj" ]; then
    local ap
    ap=$(grep -o '"apiPrefix"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    echo "${ap:-}"
  fi
}

deep_health_check_plugin() {
  local name=$1 port=$2 display_name=$3
  local api_prefix
  api_prefix=$(get_plugin_api_prefix "$name")
  [ -z "$api_prefix" ] && { log_debug "No apiPrefix for $name, skipping deep check"; return 0; }

  # Build a smoke-test URL using a safe read-only endpoint.
  # Convention: <apiPrefix>/stats or <apiPrefix>/tags are lightweight GET endpoints.
  # We try a few common ones; any non-5xx response is a pass.
  local smoke_urls=(
    "http://localhost:$port${api_prefix}/stats"
    "http://localhost:$port${api_prefix}/tags"
  )

  local passed=false
  for url in "${smoke_urls[@]}"; do
    local sc
    sc=$(curl -s -o /dev/null -w "%{http_code}" "$url" --connect-timeout 5 --max-time 10 2>/dev/null) || true
    log_debug "Deep check $url -> HTTP $sc"
    if [ -n "$sc" ] && [ "$sc" != "000" ] && [ "$sc" -lt 500 ] 2>/dev/null; then
      passed=true
      break
    fi
  done

  if [ "$passed" = true ]; then
    log_success "$display_name deep health check passed (API responds without 5xx)"
    return 0
  else
    log_warn "$display_name deep health check FAILED — API returns 5xx errors."
    echo -e "  ${YELLOW}The /healthz endpoint is OK, but actual API queries are failing.${NC}"
    echo -e "  ${DIM}This usually means:${NC}"
    echo -e "  ${DIM}  - Database schema mismatch (Prisma client out of date)${NC}"
    echo -e "  ${DIM}  - Missing database tables/schemas${NC}"
    echo -e "  ${DIM}  - Code references fields that don't exist in the schema${NC}"
    echo -e "  ${DIM}Fix: cd packages/database && npx prisma generate && npx prisma db push${NC}"
    echo -e "  ${DIM}Then restart: ./bin/start.sh restart $name${NC}"

    # Show recent errors from the log
    if [ -f "$LOG_DIR/${name}-svc.log" ]; then
      local err_lines
      err_lines=$(grep -i -E "(error|prisma|Invalid|unknown|column|field|table)" "$LOG_DIR/${name}-svc.log" 2>/dev/null | tail -5)
      if [ -n "$err_lines" ]; then
        echo -e "  ${DIM}--- Recent errors from ${name}-svc.log ---${NC}"
        echo "$err_lines" | while IFS= read -r l; do echo -e "  ${DIM}  $l${NC}"; done
        echo -e "  ${DIM}--- End ---${NC}"
      fi
    fi
    return 1
  fi
}

###############################################################################
# ARCHITECTURE DETECTION
###############################################################################

detect_architecture() {
  # web-next is the only supported shell (shell-web was retired in Phase 0)
  echo "next"
}

set_architecture() { ARCHITECTURE_MODE="$1"; log_info "Architecture mode: ${BOLD}$ARCHITECTURE_MODE${NC}"; }

get_frontend_dir() {
  # web-next is the only supported shell
  [ -d "$ROOT_DIR/apps/web" ] && echo "$ROOT_DIR/apps/web" || echo "$ROOT_DIR/apps/web-next"
}

use_unified_database() { [ "$ARCHITECTURE_MODE" = "next" ]; }

###############################################################################
# PLUGIN DISCOVERY (data-driven)
###############################################################################

# Unified database: all plugins share ONE PostgreSQL instance with
# multiple schemas. The canonical schema lives in packages/database/prisma.
UNIFIED_DB_CONTAINER="naap-db"
UNIFIED_DB_USER="postgres"
UNIFIED_DB_NAME="naap"
UNIFIED_DB_URL="postgresql://postgres:postgres@localhost:5432/naap"

# PostgreSQL schemas expected in the unified database.
# If you add a new plugin schema, add it here AND in docker/init-schemas.sql
# AND in packages/database/prisma/schema.prisma (schemas array).
PLUGIN_SCHEMAS=(
  "public"
  "plugin_community"
  "plugin_capacity"
  "plugin_developer_api"
)

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

get_plugin_frontend_port() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  [ -f "$pj" ] && grep -B2 -A5 '"frontend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
}

get_plugin_backend_port() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  [ -f "$pj" ] && grep -A5 '"backend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
}

get_plugin_display_name() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$pj" ]; then
    grep -o '"displayName"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  else echo "$1"; fi
}

get_plugin_health_path() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  if [ -f "$pj" ]; then
    local hp
    hp=$(grep -o '"healthCheck"[[:space:]]*:[[:space:]]*"[^"]*"' "$pj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    echo "${hp:-/healthz}"
  else echo "/healthz"; fi
}

# Collect all known plugin ports (for orphan cleanup)
get_all_plugin_ports() {
  local ports=()
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    local fp=$(get_plugin_frontend_port "$plugin")
    [ -n "$bp" ] && ports+=("$bp")
    [ -n "$fp" ] && ports+=("$fp")
  done
  echo "${ports[@]}"
}

###############################################################################
# DOCKER / INFRASTRUCTURE
###############################################################################

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker not found. Install from https://docs.docker.com/get-docker/"
    return 1
  fi
  if ! docker info > /dev/null 2>&1; then
    log_error "Docker is installed but not running."
    echo -e "  ${DIM}Fix: Start Docker Desktop, or run 'sudo systemctl start docker'${NC}"
    return 1
  fi
}

# Start or ensure the single unified database is running.
# Uses docker-compose.yml which defines ONE postgres container (naap-db).
ensure_databases() {
  log_info "Checking unified database..."
  check_docker || return 1

  local c="$UNIFIED_DB_CONTAINER"
  local running=$(docker ps -q -f name="$c" 2>/dev/null)

  if [ -z "$running" ]; then
    log_info "Starting unified database via docker-compose..."
    cd "$ROOT_DIR" || { log_error "Failed to cd to $ROOT_DIR"; return 1; }
    docker-compose up -d database 2>&1 | grep -v "^$" | while read -r line; do log_debug "$line"; done
    log_info "Waiting for database..."
    for i in $(seq 1 30); do
      docker exec "$c" pg_isready -U "$UNIFIED_DB_USER" > /dev/null 2>&1 && { log_success "Unified database ready"; return 0; }
      sleep 1
    done
    log_error "Unified database failed to start"; return 1
  else
    docker exec "$c" pg_isready -U "$UNIFIED_DB_USER" > /dev/null 2>&1 && { log_success "Unified database running"; return 0; }
    log_warn "Database container exists but not ready, waiting..."
    for i in $(seq 1 15); do
      docker exec "$c" pg_isready -U "$UNIFIED_DB_USER" > /dev/null 2>&1 && { log_success "Unified database ready"; return 0; }
      sleep 1
    done
    log_error "Unified database failed"; return 1
  fi
}

# Generate the unified Prisma client, push the schema, and ensure seed data.
# All plugins and services share packages/database as their Prisma source.
#
# This function is idempotent — safe to run on every start:
#   1. Regenerates the Prisma client (picks up any schema changes)
#   2. Pushes the schema to the DB (adds new columns/tables non-destructively)
#   3. Checks data integrity (users exist, plugins have CDN URLs)
#   4. Re-seeds if data is missing or incomplete
sync_unified_database() {
  log_info "Syncing unified database (schema + data)..."

  local c="$UNIFIED_DB_CONTAINER"
  local schema_file="$ROOT_DIR/packages/database/prisma/schema.prisma"
  local sync_marker="$ROOT_DIR/.prisma-synced"

  # Ensure plugin schemas exist in the database
  if docker ps -q -f name="$c" 2>/dev/null | grep -q .; then
    log_debug "Creating plugin schemas if missing..."
    if [ -f "$ROOT_DIR/docker/init-schemas.sql" ]; then
      docker exec -i "$c" psql -U "$UNIFIED_DB_USER" -d "$UNIFIED_DB_NAME" < "$ROOT_DIR/docker/init-schemas.sql" > /dev/null 2>&1 || true
    fi
  fi

  # Fast-path: if --skip-db-sync is set, trust existing state
  if [ "$SKIP_DB_SYNC" = "1" ]; then
    log_info "Skipping Prisma sync (--skip-db-sync)"
  else
    cd "$ROOT_DIR/packages/database" || { log_error "Failed to cd to packages/database"; return 1; }

    # Check if schema has changed since last sync using a hash marker file.
    # This avoids running prisma generate + db push on every start when nothing changed.
    local schema_hash=""
    if [ -f "$schema_file" ]; then
      # Use md5 on macOS, md5sum on Linux
      if command -v md5sum >/dev/null 2>&1; then
        schema_hash=$(md5sum "$schema_file" | cut -d' ' -f1)
      elif command -v md5 >/dev/null 2>&1; then
        schema_hash=$(md5 -q "$schema_file")
      fi
    fi

    local cached_hash=""
    [ -f "$sync_marker" ] && cached_hash=$(cat "$sync_marker" 2>/dev/null)

    if [ -n "$schema_hash" ] && [ "$schema_hash" = "$cached_hash" ] && \
       [ -f "$ROOT_DIR/node_modules/.prisma/client/index.js" ]; then
      log_success "Prisma client up to date (schema unchanged since last sync)"
    else
      # Step 1: Regenerate Prisma client from the source-of-truth schema.
      npx prisma generate > /dev/null 2>&1 || {
        log_error "Prisma generate failed for packages/database"
        return 1
      }
      log_debug "Prisma client generated"

      # Step 2: Push schema to database (creates tables + adds new columns).
      DATABASE_URL="$UNIFIED_DB_URL" npx prisma db push --skip-generate --accept-data-loss > /dev/null 2>&1 && \
        log_success "Schema pushed to database" || \
        log_warn "Schema push had issues (may be fine on first run)"

      # Save hash so next start can skip if unchanged
      [ -n "$schema_hash" ] && echo "$schema_hash" > "$sync_marker"
    fi
  fi

  # Step 3: Check data integrity (always runs — fast single query).
  # Verify: a) Users exist, b) Plugins have bundleUrl set.
  # Combined into a single docker exec psql call to reduce overhead.
  local need_seed=false
  local seed_check
  seed_check=$(docker exec "$c" psql -U "$UNIFIED_DB_USER" -d "$UNIFIED_DB_NAME" -t -c \
    "SELECT (SELECT count(*) FROM \"User\") AS users, (SELECT count(*) FROM \"WorkflowPlugin\" WHERE \"bundleUrl\" IS NULL) AS null_bundles" 2>/dev/null | tr -d ' ')

  if [ -n "$seed_check" ]; then
    local user_count null_bundle_count
    user_count=$(echo "$seed_check" | cut -d'|' -f1 | tr -d ' ')
    null_bundle_count=$(echo "$seed_check" | cut -d'|' -f2 | tr -d ' ')
    if [ "$user_count" = "0" ] 2>/dev/null; then
      log_info "Empty database detected (no users)"
      need_seed=true
    elif [ -n "$null_bundle_count" ] && [ "$null_bundle_count" -gt 0 ] 2>/dev/null; then
      log_info "Found $null_bundle_count plugin(s) missing CDN bundle URL"
      need_seed=true
    fi
  fi

  # Step 4: Run seed if data is missing or incomplete.
  if [ "$need_seed" = "true" ]; then
    log_info "Running database seed (upsert — safe to re-run)..."
    cd "$ROOT_DIR/apps/web-next" || { log_error "Failed to cd to apps/web-next"; return 1; }
    DATABASE_URL="$UNIFIED_DB_URL" npx tsx prisma/seed.ts > "$LOG_DIR/seed.log" 2>&1 && \
      log_success "Database seeded (users, roles, plugins, marketplace)" || \
      log_warn "Seed had issues (check logs/seed.log)"
  else
    log_success "Database data verified (users + plugin CDN URLs present)"
  fi
}

###############################################################################
# DATABASE VALIDATION
# Checks the unified database has all expected schemas with tables.
###############################################################################

validate_plugin_envs() {
  log_info "Validating plugin .env DATABASE_URL configs..."
  local ok=true
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local pdir pname
    pdir=$(dirname "$pj")
    pname=$(basename "$(dirname "$pj")")
    local envfile="$pdir/backend/.env"
    [ -f "$envfile" ] || continue

    local actual_url
    actual_url=$(grep '^DATABASE_URL=' "$envfile" 2>/dev/null | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
    [ -z "$actual_url" ] && continue

    # All plugins must point to the unified database
    if ! echo "$actual_url" | grep -q "localhost:5432/$UNIFIED_DB_NAME"; then
      log_error "$pname .env has wrong DATABASE_URL (should point to unified DB)"
      echo -e "  ${DIM}Actual:   $actual_url${NC}"
      echo -e "  ${DIM}Expected: $UNIFIED_DB_URL${NC}"
      ok=false
    fi
  done

  # Also check base-svc
  local base_url
  base_url=$(grep '^DATABASE_URL=' "$ROOT_DIR/services/base-svc/.env" 2>/dev/null | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
  if [ -n "$base_url" ] && ! echo "$base_url" | grep -q "localhost:5432/$UNIFIED_DB_NAME"; then
    log_error "base-svc .env has wrong DATABASE_URL (should point to unified DB)"
    ok=false
  fi

  [ "$ok" = true ] && log_success "All DATABASE_URLs point to unified database" || \
    log_warn "Some DATABASE_URLs are misconfigured (see errors above)"
}

check_plugin_db_connectivity() {
  log_info "Checking unified database schemas..."
  local c="$UNIFIED_DB_CONTAINER" ok=true

  # Is the container running?
  if ! docker ps -q -f name="$c" 2>/dev/null | grep -q .; then
    log_warn "Unified database container '$c' is not running"; return 1
  fi

  # Is Postgres accepting connections?
  if ! docker exec "$c" pg_isready -U "$UNIFIED_DB_USER" > /dev/null 2>&1; then
    log_warn "Unified database is not accepting connections"; return 1
  fi

  # Check each expected schema has tables
  for schema in "${PLUGIN_SCHEMAS[@]}"; do
    local table_count
    table_count=$(docker exec "$c" psql -U "$UNIFIED_DB_USER" -d "$UNIFIED_DB_NAME" -t -c \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='$schema'" 2>/dev/null | tr -d ' ')
    if [ -n "$table_count" ] && [ "$table_count" -gt 0 ] 2>/dev/null; then
      log_debug "Schema $schema: $table_count tables"
    else
      log_warn "Schema '$schema' has no tables (run: cd packages/database && npx prisma db push)"
      ok=false
    fi
  done

  [ "$ok" = true ] && log_success "All database schemas have tables" || \
    log_warn "Some schemas are missing tables (see warnings above)"
}

###############################################################################
# START FUNCTIONS
###############################################################################

###############################################################################
# PRISMA CLIENT FRESHNESS CHECK
# Ensures the generated Prisma client matches the schema. If schema.prisma
# is newer than the generated client, we regenerate to prevent runtime errors
# like "Unknown field" or "Invalid model" which manifest as 500s.
###############################################################################

ensure_prisma_client_fresh() {
  local schema_file="$ROOT_DIR/packages/database/prisma/schema.prisma"
  local client_dir="$ROOT_DIR/node_modules/.prisma/client"
  local client_marker="$client_dir/index.js"

  if [ ! -f "$schema_file" ]; then
    log_debug "No schema.prisma found at $schema_file, skipping freshness check"
    return 0
  fi

  local needs_regen=false

  # Check 1: Generated client doesn't exist
  if [ ! -f "$client_marker" ]; then
    log_warn "Prisma client not generated. Generating now..."
    needs_regen=true
  fi

  # Check 2: Schema is newer than generated client
  if [ "$needs_regen" = false ] && [ -f "$client_marker" ]; then
    if [ "$schema_file" -nt "$client_marker" ]; then
      log_warn "Prisma schema is newer than generated client. Regenerating..."
      needs_regen=true
    fi
  fi

  if [ "$needs_regen" = true ]; then
    cd "$ROOT_DIR/packages/database" || { log_error "Failed to cd to packages/database"; return 1; }
    npx prisma generate > /dev/null 2>&1 && \
      log_success "Prisma client regenerated (matches current schema)" || \
      log_error "Prisma client regeneration failed! Plugin backends may 500."
  else
    log_debug "Prisma client is up to date"
  fi
}

# Source-hash utility (shared with build-plugins.sh logic)
_plugin_src_hash() {
  local pdir="$1"
  local files_to_hash=()
  [ -d "$pdir/frontend/src" ] && files_to_hash+=("$pdir/frontend/src")
  [ -f "$pdir/frontend/package.json" ] && files_to_hash+=("$pdir/frontend/package.json")
  [ -f "$pdir/frontend/vite.config.ts" ] && files_to_hash+=("$pdir/frontend/vite.config.ts")
  [ ${#files_to_hash[@]} -eq 0 ] && { echo "empty"; return; }
  if command -v md5sum >/dev/null 2>&1; then
    find "${files_to_hash[@]}" -type f 2>/dev/null | sort | xargs md5sum 2>/dev/null | md5sum | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then
    find "${files_to_hash[@]}" -type f 2>/dev/null | sort | xargs md5 -r 2>/dev/null | md5 -q
  else echo "no-hash"; fi
}

_plugin_needs_build() {
  local pdir="$1"
  local hash_file="$pdir/frontend/dist/production/.build-hash"
  [ ! -d "$pdir/frontend/dist/production" ] && return 0
  [ ! -f "$hash_file" ] && return 0
  local current_hash cached_hash
  current_hash=$(_plugin_src_hash "$pdir")
  cached_hash=$(cat "$hash_file" 2>/dev/null)
  [ "$current_hash" != "$cached_hash" ]
}

# Copy a plugin's built bundle to the CDN-serving location.
# The CDN route reads from dist/plugins/<name>/1.0.0/, but builds output
# to plugins/<name>/frontend/dist/production/. This bridges the two.
_ensure_cdn_copy() {
  local pname=$1
  local src_dir="$ROOT_DIR/plugins/$pname/frontend/dist/production"
  local cdn_dir="$ROOT_DIR/dist/plugins/$pname/1.0.0"
  [ ! -d "$src_dir" ] && return 0
  # Skip if CDN dir is already in sync (same build hash)
  if [ -f "$cdn_dir/.build-hash" ] && [ -f "$src_dir/.build-hash" ]; then
    local s_hash c_hash
    s_hash=$(cat "$src_dir/.build-hash" 2>/dev/null)
    c_hash=$(cat "$cdn_dir/.build-hash" 2>/dev/null)
    [ "$s_hash" = "$c_hash" ] && return 0
  fi
  mkdir -p "$cdn_dir"
  cp -r "$src_dir/"* "$cdn_dir/" 2>/dev/null || true
  log_debug "Synced CDN: $pname"
}

# Detect plugins whose source code has changed since last build.
# Returns space-separated list of plugin names. Used by --fast to
# auto-detect which plugins the developer is actively working on.
_detect_changed_plugins() {
  local changed=()
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local pdir pname
    pdir=$(dirname "$pj")
    pname=$(basename "$(dirname "$pj")")
    [ -d "$pdir/frontend" ] || continue
    if _plugin_needs_build "$pdir"; then
      changed+=("$pname")
    fi
  done
  echo "${changed[*]}"
}

ensure_plugins_built() {
  log_info "Checking plugin builds..."
  local to_build=() up_to_date=0
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local pdir pname
    pdir=$(dirname "$pj")
    pname=$(basename "$(dirname "$pj")")
    [ -d "$pdir/frontend" ] || continue
    if _plugin_needs_build "$pdir"; then
      to_build+=("$pname")
    else
      ((up_to_date++)) || true
      # Ensure already-built plugins are CDN-visible
      _ensure_cdn_copy "$pname"
    fi
  done
  if [ ${#to_build[@]} -gt 0 ]; then
    log_warn "Plugins need building: ${to_build[*]} ($up_to_date already up to date)"
    for p in "${to_build[@]}"; do
      [ -d "$ROOT_DIR/plugins/$p/frontend" ] || continue
      log_info "Building $p..."
      cd "$ROOT_DIR/plugins/$p/frontend" || { log_error "Failed to cd to plugins/$p/frontend"; continue; }
      if npm run build > "$LOG_DIR/${p}-build.log" 2>&1; then
        log_success "Built $p"
        # Save build hash
        local hash_file="$ROOT_DIR/plugins/$p/frontend/dist/production/.build-hash"
        mkdir -p "$(dirname "$hash_file")"
        _plugin_src_hash "$ROOT_DIR/plugins/$p" > "$hash_file"
        # Copy to CDN location
        _ensure_cdn_copy "$p"
      else
        log_error "Failed to build $p"
        show_failure_context "$LOG_DIR/${p}-build.log" 10
      fi
    done
  else log_success "All plugins are built ($up_to_date up to date)"; fi
}

start_shell() {
  is_running "shell-web" && { log_success "Shell already running (PID $(get_pid shell-web))"; return 0; }
  kill_port $SHELL_PORT
  local fdir=$(get_frontend_dir)
  log_info "Starting Next.js shell on port $SHELL_PORT..."; cd "$fdir"

  # Only clean .next cache when explicitly requested (--clean flag) or CLEAN_NEXT=1.
  # Preserving the cache across restarts saves 30-60s of recompilation time.
  if [ "$CLEAN_NEXT" = "1" ]; then
    [ -d ".next" ] && { log_info "Cleaning .next cache (--clean)..."; rm -rf .next; }
    [ -f "$ROOT_DIR/.prisma-synced" ] && rm -f "$ROOT_DIR/.prisma-synced"
  else
    log_debug "Preserving .next cache (use --clean to force rebuild)"
  fi

  # WATCHPACK_POLLING avoids native FS watcher exhaustion (EMFILE) in large
  # monorepos when many Node.js backend processes are already running.
  # Polling interval of 1000ms is efficient enough for dev and prevents the
  # Watchpack "too many open files" error that causes all pages to 404.
  _start_shell_attempt() {
    setsid env WATCHPACK_POLLING=1000 npm run dev > "$LOG_DIR/shell-web.log" 2>&1 &
    local pid=$!
    register_pid $pid "shell-web"
    wait_for_port $SHELL_PORT "next.js shell" 60 && {
      log_success "Shell (Next.js): http://localhost:$SHELL_PORT"
      return 0
    } || {
      kill_tree $pid TERM
      unregister_pid "shell-web"
      return 1
    }
  }

  _start_shell_attempt && return 0

  # First attempt failed. If we didn't clean .next, retry with a clean cache.
  if [ "$CLEAN_NEXT" != "1" ] && [ -d ".next" ]; then
    log_warn "Shell failed to start. Retrying with clean .next cache..."
    rm -rf .next
    kill_port $SHELL_PORT
    _start_shell_attempt && return 0
  fi

  log_error "Shell failed to start on port $SHELL_PORT."
  echo -e "  ${DIM}Common fixes:${NC}"
  echo -e "  ${DIM}  - Port in use? Run: lsof -i :$SHELL_PORT${NC}"
  echo -e "  ${DIM}  - Missing .env.local? Delete node_modules and re-run ./bin/start.sh${NC}"
  echo -e "  ${DIM}  - Check full log: logs/shell-web.log${NC}"
  show_failure_context "$LOG_DIR/shell-web.log"
  return 1
}

start_base_service() {
  is_running "base-svc" && { log_success "Base service already running (PID $(get_pid base-svc))"; return 0; }
  kill_port $BASE_SVC_PORT
  log_info "Starting base-svc on port $BASE_SVC_PORT..."; cd "$ROOT_DIR/services/base-svc"
  setsid env DATABASE_URL="$UNIFIED_DB_URL" PORT=$BASE_SVC_PORT npm run dev > "$LOG_DIR/base-svc.log" 2>&1 &
  local pid=$!
  register_pid $pid "base-svc"
  wait_for_health "http://localhost:$BASE_SVC_PORT/healthz" "base-svc" 30 1 "$pid" && {
    log_success "Base Service: http://localhost:$BASE_SVC_PORT/healthz"
  } || {
    log_error "Base-svc failed to start on port $BASE_SVC_PORT."
    echo -e "  ${DIM}Common fixes:${NC}"
    echo -e "  ${DIM}  - Port in use? Run: lsof -i :$BASE_SVC_PORT${NC}"
    echo -e "  ${DIM}  - Database not running? Run: docker ps | grep naap${NC}"
    echo -e "  ${DIM}  - Check full log: logs/base-svc.log${NC}"
    show_failure_context "$LOG_DIR/base-svc.log"
    kill_tree $pid TERM
    unregister_pid "base-svc"
    return 1
  }
}

start_plugin_server() {
  is_running "plugin-server" && { log_success "Plugin server already running (PID $(get_pid plugin-server))"; return 0; }
  kill_port $PLUGIN_SERVER_PORT
  log_info "Starting plugin-server on port $PLUGIN_SERVER_PORT..."; cd "$ROOT_DIR/services/plugin-server"
  [ ! -d "node_modules" ] && (npm install --silent 2>/dev/null || npm install)
  setsid npm run dev > "$LOG_DIR/plugin-server.log" 2>&1 &
  local pid=$!
  register_pid $pid "plugin-server"
  wait_for_health "http://localhost:$PLUGIN_SERVER_PORT/healthz" "plugin-server" 30 1 "$pid" && {
    log_success "Plugin Server: http://localhost:$PLUGIN_SERVER_PORT/plugins"
  } || {
    log_error "Plugin-server failed to start on port $PLUGIN_SERVER_PORT."
    echo -e "  ${DIM}Common fixes:${NC}"
    echo -e "  ${DIM}  - Port in use? Run: lsof -i :$PLUGIN_SERVER_PORT${NC}"
    echo -e "  ${DIM}  - Missing node_modules? Run: cd services/plugin-server && npm install${NC}"
    echo -e "  ${DIM}  - Check full log: logs/plugin-server.log${NC}"
    show_failure_context "$LOG_DIR/plugin-server.log"
    kill_tree $pid TERM
    unregister_pid "plugin-server"
    return 1
  }
}

start_health_monitor() {
  is_running "health-monitor" && { log_success "Health monitor already running"; return 0; }
  log_info "Starting health monitor..."
  local monitor_script="$SCRIPT_DIR/health-monitor.sh"
  if [ ! -f "$monitor_script" ]; then
    log_warn "Health monitor script not found at $monitor_script, skipping."
    return 0
  fi
  chmod +x "$monitor_script"
  nohup bash "$monitor_script" > /dev/null 2>&1 &
  local monitor_pid=$!
  register_pid $monitor_pid "health-monitor"
  log_success "Health monitor running (PID: $monitor_pid)"
}

start_plugin_backend() {
  local name=$1 svc_name="${1}-svc"
  local port=$(get_plugin_backend_port "$name")
  local display_name=$(get_plugin_display_name "$name")
  local health_path=$(get_plugin_health_path "$name")
  [ -z "$port" ] && return 0
  is_running "$svc_name" && { log_success "$display_name backend already running (PID $(get_pid "$svc_name"))"; return 0; }
  [ ! -d "$ROOT_DIR/plugins/$name/backend" ] && { log_warn "Backend dir not found: $name"; return 1; }
  kill_port "$port"
  log_info "Starting $display_name backend on port $port..."
  cd "$ROOT_DIR/plugins/$name/backend" || { log_error "Failed to cd to plugins/$name/backend"; return 1; }

  # All plugins share the unified database via their .env files.
  # Pass DATABASE_URL explicitly to ensure consistency.
  setsid env DATABASE_URL="$UNIFIED_DB_URL" PORT="$port" npm run dev > "$LOG_DIR/${name}-svc.log" 2>&1 &
  local pid=$!
  register_pid $pid "$svc_name"
  wait_for_health "http://localhost:$port${health_path}" "$display_name" 20 1 "$pid" && {
    log_success "$display_name Backend: http://localhost:$port${health_path}"

    # Deep health check: verify actual API queries work (catches schema mismatches).
    # Only runs when --deep-check or DEBUG=1 is set to avoid slowing down every start.
    if [ "$DEEP_CHECK" = "1" ] || [ "${DEBUG:-}" = "1" ]; then
      deep_health_check_plugin "$name" "$port" "$display_name" || \
        log_warn "$display_name is running but may have issues (see warnings above)"
    fi
  } || {
    log_error "$display_name backend failed to start on port $port."
    echo -e "  ${DIM}Common fixes:${NC}"
    echo -e "  ${DIM}  - Port in use? Run: lsof -i :$port${NC}"
    echo -e "  ${DIM}  - Missing node_modules? Run: cd plugins/$name/backend && npm install${NC}"
    echo -e "  ${DIM}  - Database not ready? Run: docker ps | grep naap${NC}"
    echo -e "  ${DIM}  - Schema mismatch? Run: cd packages/database && npx prisma generate && npx prisma db push${NC}"
    echo -e "  ${DIM}  - Check full log: logs/${name}-svc.log${NC}"
    show_failure_context "$LOG_DIR/${name}-svc.log"
    kill_tree $pid TERM
    unregister_pid "$svc_name"
    return 1
  }
}

start_plugin_frontend_dev() {
  local name=$1 web_name="${1}-web"
  local fport=$(get_plugin_frontend_port "$name")
  local display_name=$(get_plugin_display_name "$name")
  [ -z "$fport" ] && return 0
  is_running "$web_name" && { log_success "$display_name frontend dev already running (PID $(get_pid "$web_name"))"; return 0; }
  [ ! -d "$ROOT_DIR/plugins/$name/frontend" ] && { log_warn "Frontend dir not found: $name"; return 1; }
  kill_port "$fport"
  log_info "Starting $display_name frontend dev on port $fport..."
  cd "$ROOT_DIR/plugins/$name/frontend" || { log_error "Failed to cd to plugins/$name/frontend"; return 1; }
  setsid npx vite --port "$fport" --strictPort > "$LOG_DIR/${name}-web.log" 2>&1 &
  local pid=$!
  register_pid $pid "$web_name"
  wait_for_port "$fport" "$display_name frontend" 30 && {
    log_success "$display_name Frontend: http://localhost:$fport"
  } || {
    log_error "$display_name frontend failed to start."
    show_failure_context "$LOG_DIR/${name}-web.log"
    kill_tree $pid TERM
    unregister_pid "$web_name"
    return 1
  }
}

verify_plugin_accessible() {
  for i in $(seq 1 5); do
    curl -sf --max-time 3 "http://localhost:$SHELL_PORT/cdn/plugins/$1/1.0.0/$1.js" > /dev/null 2>&1 && return 0; sleep 1
  done; return 1
}

verify_all_plugins() {
  if [ "$SKIP_VERIFY" = "1" ]; then
    log_info "Skipping plugin verification (--skip-verify)"
    return 0
  fi
  log_info "Verifying plugin accessibility..."
  local failed=0 verified=0

  # Run verifications in parallel for speed
  local vpids=() vnames=()
  for plugin in $(get_all_plugins); do
    (verify_plugin_accessible "$plugin") &
    vpids+=($!)
    vnames+=("$plugin")
  done

  for i in "${!vpids[@]}"; do
    if wait "${vpids[$i]}"; then
      ((verified++)) || true
    else
      ((failed++)) || true
      log_warn "Plugin ${vnames[$i]} NOT accessible"
    fi
  done

  [ $failed -gt 0 ] && log_warn "$failed plugin(s) not accessible" || log_success "All $verified plugins accessible"
}

###############################################################################
# STOP FUNCTIONS
###############################################################################

stop_service() {
  local name=$1 pid=$(get_pid "$1")
  [ -n "$pid" ] && { graceful_kill "$pid" "$name"; unregister_pid "$name"; } || log_debug "$name not running"
}

stop_plugin() {
  local pn=$1 dn=$(get_plugin_display_name "$1") stopped=false
  log_info "Stopping plugin: ${BOLD}$dn${NC}..."
  local sp=$(get_pid "${pn}-svc")
  [ -n "$sp" ] && { graceful_kill "$sp" "${pn}-svc"; unregister_pid "${pn}-svc"; stopped=true; }
  local wp=$(get_pid "${pn}-web")
  [ -n "$wp" ] && { graceful_kill "$wp" "${pn}-web"; unregister_pid "${pn}-web"; stopped=true; }
  # Safety net: kill by port
  local bp=$(get_plugin_backend_port "$pn")
  [ -n "$bp" ] && { local pp=$(lsof -ti:"$bp" 2>/dev/null || true); [ -n "$pp" ] && { kill -TERM $pp 2>/dev/null || true; stopped=true; }; }
  local fp=$(get_plugin_frontend_port "$pn")
  [ -n "$fp" ] && { local pp=$(lsof -ti:"$fp" 2>/dev/null || true); [ -n "$pp" ] && { kill -TERM $pp 2>/dev/null || true; stopped=true; }; }
  [ "$stopped" = true ] && log_success "Plugin $dn stopped" || log_warn "Plugin $dn was not running"
}

stop_all() {
  log_section "Stopping All Services"
  if [ -f "$PID_FILE" ] && [ -s "$PID_FILE" ]; then
    # Collect all live PIDs
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
      log_info "Stopping $count service(s) in parallel..."

      # Phase 1: Send SIGTERM to ALL process groups at once
      for pid in "${all_pids[@]}"; do
        kill_tree "$pid" TERM
      done

      # Phase 2: Poll until all are dead (max GRACEFUL_TIMEOUT seconds)
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
          else
            ((alive++))
          fi
        done
      done

      # Phase 3: Force-kill any survivors and their process groups
      for i in "${!all_pids[@]}"; do
        [ -z "${all_pids[$i]}" ] && continue
        log_warn "Force-killing ${all_names[$i]} (PID ${all_pids[$i]})"
        kill_tree "${all_pids[$i]}" 9
      done
    fi
  else log_info "No tracked services in PID file"; fi

  # Clean orphaned processes using discovered ports (not hardcoded ranges)
  log_info "Cleaning orphaned processes..."
  local all_ports="$SHELL_PORT $PLUGIN_SERVER_PORT $BASE_SVC_PORT"
  for port in $(get_all_plugin_ports); do
    all_ports="$all_ports $port"
  done
  for port in $all_ports; do
    local op=$(lsof -ti:"$port" 2>/dev/null || true)
    [ -n "$op" ] && { log_debug "Killing orphan on port $port (PID $op)"; kill -TERM $op 2>/dev/null || true; }
  done
  > "$PID_FILE"; echo ""; log_success "All NAAP Platform services stopped"
}

stop_shell()       { log_section "Stopping Shell"; stop_service "shell-web"; kill_port $SHELL_PORT; log_success "Shell stopped"; }
stop_all_plugins() { log_section "Stopping All Plugins"; for p in $(get_all_plugins); do stop_plugin "$p"; done; log_success "All plugins stopped"; }
stop_services()    { log_section "Stopping Core Services"; stop_service "health-monitor"; stop_service "plugin-server"; stop_service "base-svc"; kill_port $BASE_SVC_PORT; kill_port $PLUGIN_SERVER_PORT; log_success "Core services stopped"; }
stop_infra()       { log_section "Stopping Infrastructure"; check_docker && { cd "$ROOT_DIR"; docker-compose down 2>/dev/null || true; log_success "Docker containers stopped"; }; }

###############################################################################
# RESTART
###############################################################################

restart_plugin() {
  log_section "Restarting $(get_plugin_display_name "$1")"
  stop_plugin "$1"; sleep 1; start_plugin_backend "$1"
}

restart_services() {
  log_section "Restarting Core Services"
  stop_services; sleep 2; start_core
}

###############################################################################
# STATUS
###############################################################################

print_svc_status() {
  local svc=$1 dn=$2 port=$3 url=$4
  local pid=$(get_pid "$svc") ps="${DIM}--${NC}" hs=""
  if [ -n "$pid" ]; then
    ps="$pid"
    if [ -n "$url" ]; then
      local sc=$(check_health "$url")
      case "$sc" in 200) hs="${GREEN}healthy${NC}" ;; 000) hs="${RED}unreachable${NC}" ;; *) hs="${YELLOW}HTTP $sc${NC}" ;; esac
    else hs="${GREEN}running${NC}"; fi
  else
    if [ "$port" != "-" ] && nc -z localhost "$port" 2>/dev/null; then ps="${YELLOW}?${NC}"; hs="${YELLOW}untracked${NC}"
    else hs="${DIM}stopped${NC}"; fi
  fi
  printf "  %-25s %-8s %-8s %b\n" "$dn" "$port" "$ps" "$hs"
}

cmd_status() {
  echo ""; echo -e "${BOLD}NAAP Platform Status${NC}"; echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"; echo ""
  printf "  ${BOLD}%-25s %-8s %-8s %-10s${NC}\n" "SERVICE" "PORT" "PID" "HEALTH"
  printf "  %-25s %-8s %-8s %-10s\n" "-------------------------" "--------" "--------" "----------"
  print_svc_status "shell-web" "Shell" "$SHELL_PORT" "http://localhost:$SHELL_PORT"
  print_svc_status "base-svc" "Base Service" "$BASE_SVC_PORT" "http://localhost:$BASE_SVC_PORT/healthz"
  print_svc_status "plugin-server" "Plugin Server" "$PLUGIN_SERVER_PORT" "http://localhost:$PLUGIN_SERVER_PORT/healthz"
  print_svc_status "health-monitor" "Health Monitor" "-" ""
  echo ""; printf "  ${BOLD}%-25s${NC}\n" "PLUGIN BACKENDS"
  printf "  %-25s %-8s %-8s %-10s\n" "-------------------------" "--------" "--------" "----------"
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    local hp=$(get_plugin_health_path "$plugin")
    [ -n "$bp" ] && print_svc_status "${plugin}-svc" "$(get_plugin_display_name "$plugin")" "$bp" "http://localhost:$bp${hp}"
  done
  echo ""
  if docker info > /dev/null 2>&1; then
    local cnt=$(docker ps --filter "name=naap-" --format "{{.Names}}" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${BOLD}Infrastructure:${NC} $cnt Docker container(s)"
    [ "$cnt" -gt 0 ] && docker ps --filter "name=naap-" --format "    {{.Names}} ({{.Status}})" 2>/dev/null
  else echo -e "  ${BOLD}Infrastructure:${NC} ${RED}Docker not running${NC}"; fi
  echo ""
}

cmd_watch() {
  local interval=${1:-5}
  log_info "Live status dashboard (refresh every ${interval}s, Ctrl+C to stop)"
  while true; do
    clear
    cmd_status
    echo -e "  ${DIM}Auto-refresh every ${interval}s. Press Ctrl+C to exit.${NC}"
    sleep "$interval"
  done
}

###############################################################################
# VALIDATE
###############################################################################

cmd_validate() {
  echo ""; echo -e "${BOLD}NAAP Platform Validation${NC}"; echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"; echo ""
  local passed=0 failed=0 skipped=0

  _vld() {
    local code=$(check_health "$2")
    case "$code" in
      200) echo -e "  ${GREEN}[PASS]${NC} $1"; ((passed++)) || true ;;
      000) echo -e "  ${YELLOW}[SKIP]${NC} $1 (not running)"; ((skipped++)) || true ;;
      *)   echo -e "  ${RED}[FAIL]${NC} $1 (HTTP $code)"; ((failed++)) || true ;;
    esac
  }
  _vld_multi() {
    local code=$(check_health "$2")
    if echo "$code" | grep -qE "^($3)$"; then echo -e "  ${GREEN}[PASS]${NC} $1"; ((passed++)) || true
    elif [ "$code" = "000" ]; then echo -e "  ${YELLOW}[SKIP]${NC} $1 (not running)"; ((skipped++)) || true
    else echo -e "  ${RED}[FAIL]${NC} $1 (HTTP $code)"; ((failed++)) || true; fi
  }

  log_section "Core Services"
  _vld "Base Service" "http://localhost:$BASE_SVC_PORT/healthz"
  _vld "Plugin Server" "http://localhost:$PLUGIN_SERVER_PORT/healthz"
  _vld "Shell" "http://localhost:$SHELL_PORT"

  log_section "Plugin Backends"
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    local hp=$(get_plugin_health_path "$plugin")
    [ -n "$bp" ] && _vld "$(get_plugin_display_name "$plugin") Backend" "http://localhost:$bp${hp}"
  done

  log_section "Plugin Assets (CDN)"
  for plugin in $(get_all_plugins); do
    _vld "$(get_plugin_display_name "$plugin") CDN bundle" "http://localhost:$SHELL_PORT/cdn/plugins/$plugin/1.0.0/$plugin.js"
  done

  log_section "Plugin .env Configuration (Unified DB)"
  for plugin in $(get_all_plugins); do
    local envfile="$ROOT_DIR/plugins/$plugin/backend/.env"
    [ -f "$envfile" ] || continue
    local actual_url
    actual_url=$(grep '^DATABASE_URL=' "$envfile" 2>/dev/null | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
    if [ -z "$actual_url" ]; then
      echo -e "  ${YELLOW}[SKIP]${NC} $plugin: no DATABASE_URL in .env"; ((skipped++)) || true
    elif echo "$actual_url" | grep -q "localhost:5432/$UNIFIED_DB_NAME"; then
      echo -e "  ${GREEN}[PASS]${NC} $plugin .env -> unified DB"; ((passed++)) || true
    else
      echo -e "  ${RED}[FAIL]${NC} $plugin .env DATABASE_URL not pointing to unified DB"; ((failed++)) || true
      echo -e "         ${DIM}Actual:   $actual_url${NC}"
      echo -e "         ${DIM}Expected: $UNIFIED_DB_URL${NC}"
    fi
  done

  log_section "Unified Database Schemas"
  local c="$UNIFIED_DB_CONTAINER"
  if docker ps -q -f name="$c" 2>/dev/null | grep -q . && \
     docker exec "$c" pg_isready -U "$UNIFIED_DB_USER" > /dev/null 2>&1; then
    for schema in "${PLUGIN_SCHEMAS[@]}"; do
      local tc se
      # Check if schema exists
      se=$(docker exec "$c" psql -U "$UNIFIED_DB_USER" -d "$UNIFIED_DB_NAME" -t -c \
        "SELECT 1 FROM information_schema.schemata WHERE schema_name='$schema'" 2>/dev/null | tr -d ' ')
      tc=$(docker exec "$c" psql -U "$UNIFIED_DB_USER" -d "$UNIFIED_DB_NAME" -t -c \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema='$schema'" 2>/dev/null | tr -d ' ')
      if [ -n "$tc" ] && [ "$tc" -gt 0 ] 2>/dev/null; then
        echo -e "  ${GREEN}[PASS]${NC} Schema $schema ($tc tables)"; ((passed++)) || true
      elif [ "$se" = "1" ]; then
        echo -e "  ${GREEN}[PASS]${NC} Schema $schema (exists, no tables yet)"; ((passed++)) || true
      else
        echo -e "  ${RED}[FAIL]${NC} Schema $schema (missing — check docker/init-schemas.sql)"; ((failed++)) || true
      fi
    done
  else
    echo -e "  ${YELLOW}[SKIP]${NC} Unified database not running"; ((skipped++)) || true
  fi

  log_section "Plugin API Deep Checks (DB connectivity)"
  for plugin in $(get_all_plugins); do
    local bp=$(get_plugin_backend_port "$plugin")
    [ -z "$bp" ] && continue
    local dn=$(get_plugin_display_name "$plugin")
    local api_prefix=$(get_plugin_api_prefix "$plugin")
    [ -z "$api_prefix" ] && continue

    # Try stats or tags endpoint to verify actual DB queries work
    local smoke_url="http://localhost:$bp${api_prefix}/stats"
    local smoke_code=$(check_health "$smoke_url")
    if [ "$smoke_code" = "000" ]; then
      echo -e "  ${YELLOW}[SKIP]${NC} $dn API deep check (not running)"; ((skipped++)) || true
    elif [ -n "$smoke_code" ] && [ "$smoke_code" -lt 500 ] 2>/dev/null; then
      echo -e "  ${GREEN}[PASS]${NC} $dn API deep check (HTTP $smoke_code)"; ((passed++)) || true
    else
      echo -e "  ${RED}[FAIL]${NC} $dn API deep check (HTTP $smoke_code — likely schema/DB mismatch)"; ((failed++)) || true
      echo -e "         ${DIM}Fix: cd packages/database && npx prisma generate && npx prisma db push${NC}"
    fi
  done

  log_section "Core API Endpoints"
  _vld_multi "Auth API (Legacy)" "http://localhost:$BASE_SVC_PORT/api/v1/base/auth/session" "200|401"
  _vld "Feature Flags" "http://localhost:$BASE_SVC_PORT/api/v1/base/config/features"
  _vld "Workflow Plugins" "http://localhost:$BASE_SVC_PORT/api/v1/base/plugins"
  _vld "Marketplace Registry" "http://localhost:$BASE_SVC_PORT/api/v1/registry/packages"
  _vld "Health Check" "http://localhost:$BASE_SVC_PORT/healthz"

  echo ""; echo "================================================"
  echo -e "${BOLD}Results${NC}: ${GREEN}$passed passed${NC}, ${YELLOW}$skipped skipped${NC}, ${RED}$failed failed${NC}"
  echo "================================================"
  [ "$failed" -gt 0 ] && return 1 || return 0
}

###############################################################################
# ENVIRONMENT FILE AUTO-CREATION
# Ensures .env files exist for services and plugin backends.
# These files are gitignored, so fresh clones won't have them.
###############################################################################

ensure_env_files() {
  log_info "Checking .env files..."
  local created=0

  # base-svc .env
  local base_env="$ROOT_DIR/services/base-svc/.env"
  if [ ! -f "$base_env" ]; then
    cat > "$base_env" <<BEOF
DATABASE_URL="$UNIFIED_DB_URL"
PORT=4000
BEOF
    ((created++)) || true
    log_debug "Created $base_env"
  fi

  # Plugin backend .env files
  for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
    [ -f "$pj" ] || continue
    local pdir pname
    pdir=$(dirname "$pj")
    pname=$(basename "$(dirname "$pj")")
    local envfile="$pdir/backend/.env"
    [ -d "$pdir/backend" ] || continue
    if [ ! -f "$envfile" ]; then
      local bp=$(get_plugin_backend_port "$pname")
      local schema
      # Derive schema name from plugin name: my-dashboard -> plugin_dashboard
      case "$pname" in
        capacity-planner) schema="plugin_capacity" ;;
        community)        schema="plugin_community" ;;
        developer-api)    schema="plugin_developer_api" ;;
        marketplace)      schema="plugin_marketplace" ;;
        plugin-publisher) schema="plugin_publisher" ;;
        *) schema="public" ;;
      esac
      cat > "$envfile" <<PEOF
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${UNIFIED_DB_NAME}?schema=${schema}"
PORT=${bp:-4099}
PEOF
      ((created++)) || true
      log_debug "Created $envfile"
    fi
  done

  # apps/web-next/.env.local
  local web_env="$ROOT_DIR/apps/web-next/.env.local"
  if [ ! -f "$web_env" ]; then
    cat > "$web_env" <<WEOF
# NAAP Platform - Local Development Configuration (auto-generated)
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-change-me-in-production-min-32-chars
DATABASE_URL=$UNIFIED_DB_URL
BASE_SVC_URL=http://localhost:4000
PLUGIN_SERVER_URL=http://localhost:3100
WEOF
    ((created++)) || true
    log_debug "Created $web_env"
  fi

  [ $created -gt 0 ] && log_success "Created $created missing .env file(s)" || log_success "All .env files present"
}

###############################################################################
# COMPOSITE START COMMANDS
###############################################################################

setup_infra()      { log_section "Infrastructure"; ensure_env_files; ensure_databases || { log_error "Database setup failed."; exit 1; }; }
# Note: ensure_prisma_client_fresh is NOT called here — sync_unified_database
# already handles prisma generate (with hash-based caching). Calling it twice
# was adding 3-5s of redundant work on every start.
setup_infra_full() { setup_infra; sync_unified_database; validate_plugin_envs; check_plugin_db_connectivity; }
start_core() {
  log_section "Core Services"
  # Start base-svc and plugin-server in parallel (they are independent)
  start_base_service &
  local _base_pid=$!
  start_plugin_server &
  local _ps_pid=$!
  local _core_fail=0
  wait $_base_pid || { log_error "Base service failed."; _core_fail=1; }
  wait $_ps_pid   || { log_error "Plugin server failed."; _core_fail=1; }
  [ $_core_fail -gt 0 ] && exit 1
  start_health_monitor
}

# Get the list of plugins to start, respecting --no-plugins and --only=x,y
get_plugins_to_start() {
  if [ "$NO_PLUGINS" = "1" ]; then
    echo ""
    return
  fi
  if [ -n "$ONLY_PLUGINS" ]; then
    # Convert comma-separated list to space-separated
    echo "$ONLY_PLUGINS" | tr ',' ' '
    return
  fi
  get_all_plugins
}

# Sequential backend startup
start_all_be_sequential() {
  local f=0
  for p in $(get_plugins_to_start); do
    start_plugin_backend "$p" || ((f++)) || true
  done
  [ $f -gt 0 ] && log_warn "$f backend(s) failed"
  return 0
}

# Parallel backend startup (faster, default)
start_all_be_parallel() {
  local pids=() names=() logfiles=()
  for p in $(get_plugins_to_start); do
    local port=$(get_plugin_backend_port "$p")
    [ -z "$port" ] && continue
    is_running "${p}-svc" && { log_success "$(get_plugin_display_name "$p") backend already running"; continue; }
    start_plugin_backend "$p" &
    pids+=($!)
    names+=("$p")
    logfiles+=("$LOG_DIR/${p}-svc.log")
  done

  if [ ${#pids[@]} -eq 0 ]; then
    log_success "All plugin backends already running (or none selected)"
    return 0
  fi

  log_info "Waiting for ${#pids[@]} backends to start (parallel)..."
  local f=0
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || {
      ((f++)) || true
      log_warn "Backend ${names[$i]} may have issues"
    }
  done
  [ $f -gt 0 ] && log_warn "$f backend(s) had startup issues" || log_success "All ${#pids[@]} backends started"
  return 0
}

# Smart backend startup: parallel by default, sequential with --sequential
start_all_be() {
  if [ "$NO_PLUGINS" = "1" ]; then
    log_section "Plugin Backends"
    log_info "Skipping all plugin backends (--no-plugins)"
    return 0
  fi
  if [ -n "$ONLY_PLUGINS" ]; then
    log_section "Plugin Backends (selected: $ONLY_PLUGINS)"
  else
    log_section "Plugin Backends"
  fi
  if [ "$PARALLEL_START" = "1" ]; then
    start_all_be_parallel
  else
    start_all_be_sequential
  fi
}

start_fe() { log_section "Frontend"; start_shell || { log_error "Shell failed."; exit 1; }; }

cmd_start_all() {
  log_info "Starting ${BOLD}all${NC} NAAP services..."
  local t
  t=$(date +%s)
  acquire_lock
  preflight_check
  _tstart; setup_infra_full; _tend "Infrastructure"
  _tstart; ensure_plugins_built; _tend "Plugin builds"
  _tstart; start_core; _tend "Core services"

  # Start shell and backends in parallel — they are independent.
  _tstart
  start_fe &
  local shell_pid=$!
  start_all_be || true
  wait $shell_pid || { log_error "Shell failed."; release_lock; exit 1; }
  _tend "Shell + backends (parallel)"

  _tstart; verify_all_plugins || true; _tend "Plugin verification"
  release_lock
  log_success "All services started in $(( $(date +%s) - t ))s!"; _summary_full; _print_timing
}

cmd_start_shell() {
  log_info "Starting shell + core..."
  local t
  t=$(date +%s)
  acquire_lock
  preflight_check
  # When --clean is set, run full infra+DB sync (not just setup_infra)
  if [ "$CLEAN_NEXT" = "1" ]; then
    _tstart; setup_infra_full; _tend "Infrastructure"
  else
    _tstart; setup_infra; _tend "Infrastructure"
  fi
  _tstart; ensure_plugins_built; _tend "Plugin builds"
  _tstart; start_core; _tend "Core services"
  _tstart; start_fe; _tend "Frontend (Next.js)"
  _tstart; verify_all_plugins || true; _tend "Plugin verification"
  release_lock
  log_success "Started in $(( $(date +%s) - t ))s"; _summary_shell; _print_timing
}

cmd_start_shell_with_backends() {
  log_info "Starting shell + backends..."
  local t
  t=$(date +%s)
  acquire_lock
  preflight_check
  _tstart; setup_infra_full; _tend "Infrastructure"
  _tstart; ensure_plugins_built; _tend "Plugin builds"
  _tstart; start_core; _tend "Core services"

  # Start shell and backends in parallel
  _tstart
  start_fe &
  local shell_pid=$!
  start_all_be || true
  wait $shell_pid || { log_error "Shell failed."; release_lock; exit 1; }
  _tend "Shell + backends (parallel)"

  _tstart; verify_all_plugins || true; _tend "Plugin verification"
  release_lock
  log_success "Started in $(( $(date +%s) - t ))s"; _summary_be; _print_timing
}

cmd_start_services() {
  log_info "Starting services only..."
  acquire_lock
  preflight_check
  setup_infra_full; start_core; start_all_be || true
  release_lock
  _summary_svc
}

cmd_start_plugins() {
  local names=("$@")
  acquire_lock
  preflight_check
  setup_infra; ensure_plugins_built; start_core
  log_section "Selected Plugins"
  for p in "${names[@]}"; do [ -d "$ROOT_DIR/plugins/$p" ] && start_plugin_backend "$p" || log_error "Not found: $p"; done
  start_fe; verify_all_plugins || true
  release_lock
  _summary_full
}

# Dev mode: start a single plugin with frontend + backend in dev
cmd_dev_plugin() {
  local name=$1
  [ ! -d "$ROOT_DIR/plugins/$name" ] && { log_error "Plugin not found: $name"; cmd_list; exit 1; }
  log_info "Starting ${BOLD}$(get_plugin_display_name "$name")${NC} in full dev mode..."
  local t
  t=$(date +%s)
  acquire_lock
  preflight_check
  setup_infra; start_core
  start_plugin_backend "$name"
  start_plugin_frontend_dev "$name"
  start_fe
  release_lock
  local bp=$(get_plugin_backend_port "$name")
  local fp=$(get_plugin_frontend_port "$name")
  echo ""; echo "================================================"
  echo -e "${GREEN}${BOLD}Dev Mode: $(get_plugin_display_name "$name")${NC}"
  echo "================================================"
  echo "  Shell:          http://localhost:$SHELL_PORT"
  [ -n "$bp" ] && echo "  Backend:        http://localhost:$bp/healthz"
  [ -n "$fp" ] && echo "  Frontend (HMR): http://localhost:$fp"
  echo "  Logs backend:   logs/${name}-svc.log"
  echo "  Logs frontend:  logs/${name}-web.log"
  echo ""; echo "  Started in $(( $(date +%s) - t ))s"
  echo "================================================"
}

###############################################################################
# SUMMARIES
###############################################################################

_summary_shell() {
  echo ""; echo "================================================"
  echo -e "${GREEN}${BOLD}NAAP Platform - Shell Only${NC}"; echo "================================================"
  echo "  Shell:          http://localhost:$SHELL_PORT"
  echo "  Base Service:   http://localhost:$BASE_SVC_PORT/healthz"
  echo "  Plugin Server:  http://localhost:$PLUGIN_SERVER_PORT/plugins"; echo ""
  echo "  Stop: ./bin/stop.sh    Status: ./bin/start.sh status"
  echo "================================================"
}
_summary_be() {
  local started_plugins
  started_plugins=$(get_plugins_to_start)
  echo ""; echo "================================================"
  if [ -n "$ONLY_PLUGINS" ]; then
    echo -e "${GREEN}${BOLD}NAAP Platform - Shell + Selected Backends${NC}"
  else
    echo -e "${GREEN}${BOLD}NAAP Platform - Shell + Backends${NC}"
  fi
  echo "================================================"
  echo "  Shell:          http://localhost:$SHELL_PORT"
  echo "  Base Service:   http://localhost:$BASE_SVC_PORT/healthz"
  echo "  Plugin Server:  http://localhost:$PLUGIN_SERVER_PORT/plugins"
  if [ -n "$started_plugins" ]; then
    echo "  Plugin Backends:"
    for p in $started_plugins; do local bp=$(get_plugin_backend_port "$p"); [ -n "$bp" ] && printf "    %-22s http://localhost:%s/healthz\n" "$(get_plugin_display_name "$p"):" "$bp"; done
  fi
  echo ""; echo "  Stop: ./bin/stop.sh    Status: ./bin/start.sh status"
  echo "================================================"
}
_summary_full() {
  echo ""; echo "================================================"
  echo -e "${GREEN}${BOLD}NAAP Platform Running${NC}"; echo "================================================"
  echo "  Shell:          http://localhost:$SHELL_PORT"
  echo "  Base Service:   http://localhost:$BASE_SVC_PORT/healthz"
  echo "  Plugin Server:  http://localhost:$PLUGIN_SERVER_PORT/plugins"; echo "  Plugin Backends:"
  for p in $(get_all_plugins); do local bp=$(get_plugin_backend_port "$p"); [ -n "$bp" ] && printf "    %-22s http://localhost:%s\n" "$(get_plugin_display_name "$p"):" "$bp"; done
  echo ""; echo "  Stop: ./bin/stop.sh    Status: ./bin/start.sh status"
  echo "================================================"
}
_summary_svc() {
  echo ""; echo "================================================"
  echo -e "${GREEN}${BOLD}NAAP Platform - Services Only${NC}"; echo "================================================"
  echo "  Base Service:   http://localhost:$BASE_SVC_PORT/healthz"
  echo "  Plugin Server:  http://localhost:$PLUGIN_SERVER_PORT/plugins"; echo "  Plugin Backends:"
  for p in $(get_all_plugins); do local bp=$(get_plugin_backend_port "$p"); [ -n "$bp" ] && printf "    %-22s http://localhost:%s/healthz\n" "$(get_plugin_display_name "$p"):" "$bp"; done
  echo ""; echo "  Stop: ./bin/stop.sh    Status: ./bin/start.sh status"
  echo "================================================"
}

###############################################################################
# LIST & LOGS
###############################################################################

cmd_list() {
  echo ""; echo -e "${BOLD}Available Plugins${NC}"; echo ""
  printf "  ${BOLD}%-25s %-12s %-12s %-8s${NC}\n" "NAME" "FRONTEND" "BACKEND" "STATUS"
  printf "  %-25s %-12s %-12s %-8s\n" "-------------------------" "------------" "------------" "--------"
  for p in $(get_all_plugins); do
    local dn=$(get_plugin_display_name "$p") fp=$(get_plugin_frontend_port "$p") bp=$(get_plugin_backend_port "$p")
    local st="${DIM}stopped${NC}"; is_running "${p}-svc" && st="${GREEN}running${NC}"
    printf "  %-25s %-12s %-12s %b\n" "$dn" "${fp:-N/A}" "${bp:-N/A}" "$st"
  done; echo ""
}

cmd_logs() {
  local svc=$1
  if [ -z "$svc" ]; then
    echo "Available logs:"; ls -1 "$LOG_DIR"/*.log 2>/dev/null | while read -r f; do echo "  $(basename "$f" .log)"; done
    echo ""; echo "Usage: ./bin/start.sh logs <name>"; return
  fi
  local lf="$LOG_DIR/${svc}.log"
  [ ! -f "$lf" ] && lf="$LOG_DIR/${svc}-svc.log"
  [ ! -f "$lf" ] && lf="$LOG_DIR/${svc}-web.log"
  [ -f "$lf" ] && { log_info "Tailing $lf (Ctrl+C to stop)"; tail -f "$lf"; } || \
    { log_error "No log found for: $svc"; ls -1 "$LOG_DIR"/*.log 2>/dev/null | while read -r f; do echo "  $(basename "$f" .log)"; done; }
}

###############################################################################
# HELP
###############################################################################

show_help() {
  echo ""
  echo -e "${BOLD}NAAP Platform Manager${NC} ${DIM}(Development Tooling)${NC}"
  echo ""
  echo "Usage: ./bin/start.sh [command] [options]"
  echo ""
  echo -e "${BOLD}Commands:${NC}"
  echo "  (default)                Smart start: shell + core + auto-detected plugins"
  echo "  --all                    Start everything (all plugin backends)"
  echo "  <plugin> [plugin...]     Start shell + core + named plugin backends"
  echo "  dev <plugin>             Full dev mode (frontend HMR + backend)"
  echo "  status                   Show status of all services"
  echo "  validate                 Health-check all running services"
  echo "  list                     List available plugins"
  echo "  logs [service]           Tail logs for a service"
  echo "  restart [plugin...]      Restart services or specific plugins"
  echo "  watch [seconds]          Live status dashboard"
  echo "  help                     Show this help"
  echo ""
  echo -e "${BOLD}Options:${NC}"
  echo "  --clean                  Fresh start: clean .next cache + force DB re-sync"
  echo "  --no-plugins             Start shell + core only, skip plugin backends"
  echo "  --skip-db                Skip database sync (trust existing state)"
  echo "  --timing                 Show per-phase timing breakdown"
  echo "  --verbose                Verbose output + deep API health checks"
  echo ""
  echo -e "${BOLD}Stop (use ./bin/stop.sh):${NC}"
  echo "  ./bin/stop.sh            Stop all NAAP services"
  echo "  ./bin/stop.sh <plugin>   Stop a specific plugin"
  echo "  ./bin/stop.sh --infra    Also stop Docker containers"
  echo ""
  echo -e "${BOLD}Environment Variables:${NC}"
  echo "  GRACEFUL_TIMEOUT=N       Force-kill timeout in seconds (default: 5)"
  echo "  PARALLEL_START=0         Force sequential backend startup"
  echo ""
  echo -e "${BOLD}Quick Start:${NC}"
  echo "  ./bin/start.sh                            # Smart start (auto-detects changes)"
  echo "  ./bin/start.sh community                  # Shell + community backend"
  echo "  ./bin/start.sh community gateway-manager  # Shell + 2 plugins"
  echo "  ./bin/start.sh --all                      # Everything"
  echo "  ./bin/start.sh dev daydream-video          # Full dev mode (HMR)"
  echo ""
  echo -e "${BOLD}First time?${NC} Just run ${CYAN}./bin/start.sh${NC} — setup is automatic on fresh clones."
  echo ""
  echo -e "${DIM}Note: This is development tooling. For production deployment, see docs/deployment.${NC}"
  echo ""
}

###############################################################################
# MAIN - Command Dispatcher
###############################################################################

mkdir -p "$LOG_DIR"; touch "$PID_FILE"; rmdir "${PID_FILE}.lock" 2>/dev/null || true

# Parse global flags (simplified — old flags still accepted for backward compat)
ALL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    # Primary flags
    --clean)        CLEAN_NEXT=1; SKIP_DB_SYNC=0 ;;
    --no-plugins)   NO_PLUGINS=1 ;;
    --skip-db)      SKIP_DB_SYNC=1 ;;
    --timing)       SHOW_TIMING=1 ;;
    --verbose)      DEBUG=1; DEEP_CHECK=1 ;;
    # Backward compat (silently accepted, not shown in help)
    --fast)         : ;;  # Smart start is now the default behavior
    --skip-verify)  SKIP_VERIFY=1 ;;
    --skip-db-sync) SKIP_DB_SYNC=1 ;;
    --deep-check)   DEEP_CHECK=1 ;;
    --sequential)   PARALLEL_START=0 ;;
    --parallel)     : ;;  # Already the default
    --legacy|--next) : ;; # Dead flags, silently ignored
    --only=*)       ONLY_PLUGINS="${arg#--only=}" ;;
    *)              ALL_ARGS+=("$arg") ;;
  esac
done

set_architecture "$(detect_architecture)"

COMMAND="${ALL_ARGS[0]:-}"
COMMAND_ARGS=("${ALL_ARGS[@]:1}")

# Backward compat: bare flags become "start <flag>"
case "$COMMAND" in
  --all|--shell|--shell-with-backends|--with-backends|--services|--plugins|--list|--no-plugins)
    COMMAND_ARGS=("$COMMAND" "${COMMAND_ARGS[@]}"); COMMAND="start" ;;
esac

case "$COMMAND" in
  --infra)
    preflight_check
    setup_infra_full
    log_success "Infrastructure ready (Docker + DB sync). Run ./bin/start.sh to start the platform."
    ;;
  start|"")
    case "${COMMAND_ARGS[0]:-}" in
      --all)        cmd_start_all ;;
      --no-plugins) cmd_start_shell ;;
      --list)       cmd_list ;;
      # Backward compat (hidden from help)
      --shell)                               cmd_start_shell ;;
      --shell-with-backends|--with-backends) cmd_start_shell_with_backends ;;
      --services)                            cmd_start_services ;;
      --plugins)                             cmd_start_shell_with_backends ;;
      "")
        # Smart default: auto-detect which plugins the dev is working on
        # (source code changed since last build) and start those backends.
        if [ -n "$ONLY_PLUGINS" ]; then
          cmd_start_shell_with_backends
        elif [ "$NO_PLUGINS" != "1" ]; then
          _CHANGED=$(_detect_changed_plugins)
          if [ -n "$_CHANGED" ]; then
            ONLY_PLUGINS="marketplace"
            for _cp in $_CHANGED; do
              [ "$_cp" = "marketplace" ] && continue
              ONLY_PLUGINS="$ONLY_PLUGINS,$_cp"
            done
            log_info "Smart mode: detected changed plugin(s): ${YELLOW}$_CHANGED${NC}"
            log_info "Starting marketplace + changed backends..."
            cmd_start_shell_with_backends
          else
            cmd_start_shell
          fi
        else
          cmd_start_shell
        fi ;;
      *)  cmd_start_plugins "${COMMAND_ARGS[@]}" ;;
    esac ;;
  stop)
    # Backward compat: ./bin/start.sh stop still works (prefer ./bin/stop.sh)
    case "${COMMAND_ARGS[0]:-}" in
      "")         stop_all ;;
      --shell)    stop_shell ;;
      --services) stop_services ;;
      --plugins)  stop_all_plugins ;;
      --infra)    stop_all; stop_infra ;;
      --all)      stop_all ;;
      *)          for p in "${COMMAND_ARGS[@]}"; do [ -d "$ROOT_DIR/plugins/$p" ] && stop_plugin "$p" || log_error "Not found: $p"; done ;;
    esac ;;
  restart)
    case "${COMMAND_ARGS[0]:-}" in
      "")         stop_all; sleep 2; cmd_start_all ;;
      --services) restart_services ;;
      --all)      stop_all; sleep 2; cmd_start_all ;;
      *)          for p in "${COMMAND_ARGS[@]}"; do [ -d "$ROOT_DIR/plugins/$p" ] && restart_plugin "$p" || log_error "Not found: $p"; done ;;
    esac ;;
  setup)
    # Backward compat: redirect to self (setup is now inline)
    log_warn "The 'setup' command is deprecated. Setup is automatic on first run."
    log_info "Just run: ./bin/start.sh"
    ;;
  dev)
    [ -z "${COMMAND_ARGS[0]:-}" ] && { log_error "Usage: ./bin/start.sh dev <plugin_name>"; cmd_list; exit 1; }
    cmd_dev_plugin "${COMMAND_ARGS[0]}" ;;
  status)        cmd_status ;;
  watch)         cmd_watch "${COMMAND_ARGS[0]:-5}" ;;
  validate)      cmd_validate ;;
  list)          cmd_list ;;
  logs)          cmd_logs "${COMMAND_ARGS[0]:-}" ;;
  -h|--help|help) show_help ;;
  *)
    # Smart plugin-name shortcut: ./bin/start.sh community → start community backend
    # Also handles multiple: ./bin/start.sh community gateway-manager
    if [ -d "$ROOT_DIR/plugins/$COMMAND" ]; then
      ONLY_PLUGINS="$COMMAND"
      for extra in "${COMMAND_ARGS[@]}"; do
        if [ -d "$ROOT_DIR/plugins/$extra" ]; then
          ONLY_PLUGINS="$ONLY_PLUGINS,$extra"
        else
          log_warn "Unknown plugin: $extra (skipped)"
        fi
      done
      cmd_start_shell_with_backends
    else
      log_error "Unknown command: $COMMAND"
      show_help; exit 1
    fi ;;
esac
