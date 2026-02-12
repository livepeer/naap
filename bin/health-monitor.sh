#!/bin/bash

# NAAP Platform - Health Monitor Daemon
# Monitors plugin-server and all plugin backends, auto-restarts on failure.
# Started automatically by start.sh; can also be run standalone.
#
# Configuration via environment:
#   MONITOR_INTERVAL=30      Health check interval in seconds (default: 30)
#   MONITOR_RESTART=1        Enable auto-restart (default: 1)
#   MONITOR_ALL_BACKENDS=1   Also monitor plugin backends (default: 0)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$ROOT_DIR/.pids"
LOG_FILE="$ROOT_DIR/logs/health-monitor.log"
LOG_DIR="$ROOT_DIR/logs"

MONITOR_INTERVAL="${MONITOR_INTERVAL:-30}"
MONITOR_RESTART="${MONITOR_RESTART:-1}"
MONITOR_ALL_BACKENDS="${MONITOR_ALL_BACKENDS:-0}"
PLUGIN_SERVER_PORT=3100

hm_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

register_pid_file() {
  local pid=$1 name=$2
  touch "$PID_FILE"
  local tmp="${PID_FILE}.tmp.$$"
  grep -v " ${name}$" "$PID_FILE" > "$tmp" 2>/dev/null || true
  echo "$pid $name" >> "$tmp"
  mv "$tmp" "$PID_FILE"
}

get_plugin_backend_port() {
  local pj="$ROOT_DIR/plugins/$1/plugin.json"
  [ -f "$pj" ] && grep -A5 '"backend"' "$pj" | grep -o '"devPort"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | grep -o '[0-9]*'
}

restart_plugin_server() {
  hm_log "Restarting plugin-server..."

  # Graceful kill first, then force
  lsof -ti:${PLUGIN_SERVER_PORT} 2>/dev/null | xargs kill -TERM 2>/dev/null || true
  sleep 2
  lsof -ti:${PLUGIN_SERVER_PORT} 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1

  cd "$ROOT_DIR/services/plugin-server"
  npm run dev >> "$LOG_DIR/plugin-server.log" 2>&1 &
  local pid=$!
  sleep 5

  if curl -sf --max-time 3 "http://localhost:${PLUGIN_SERVER_PORT}/healthz" > /dev/null 2>&1; then
    register_pid_file "$pid" "plugin-server"
    hm_log "Plugin-server restarted successfully (PID $pid)"
  else
    hm_log "FAILED to restart plugin-server"
    kill "$pid" 2>/dev/null || true
  fi
}

restart_plugin_backend() {
  local name=$1 port=$2
  hm_log "Restarting plugin backend: $name on port $port..."

  lsof -ti:"$port" 2>/dev/null | xargs kill -TERM 2>/dev/null || true
  sleep 2
  lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1

  local svc_name="${name}-svc"
  cd "$ROOT_DIR/plugins/$name/backend"
  PORT="$port" npm run dev >> "$LOG_DIR/${name}-svc.log" 2>&1 &
  local pid=$!
  sleep 5

  if curl -sf --max-time 3 "http://localhost:$port/healthz" > /dev/null 2>&1; then
    register_pid_file "$pid" "$svc_name"
    hm_log "Plugin $name restarted successfully (PID $pid)"
  else
    hm_log "FAILED to restart plugin $name"
    kill "$pid" 2>/dev/null || true
  fi
}

# Graceful shutdown handler
_SLEEP_PID=""
cleanup() {
  hm_log "Health monitor shutting down"
  [ -n "$_SLEEP_PID" ] && kill "$_SLEEP_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

hm_log "Health monitor started (interval=${MONITOR_INTERVAL}s, restart=${MONITOR_RESTART}, backends=${MONITOR_ALL_BACKENDS})"

while true; do
  # Check plugin-server
  if ! curl -sf --max-time 5 "http://localhost:${PLUGIN_SERVER_PORT}/healthz" > /dev/null 2>&1; then
    hm_log "Plugin-server health check FAILED"
    [ "$MONITOR_RESTART" = "1" ] && restart_plugin_server
  fi

  # Optionally check all plugin backends
  if [ "$MONITOR_ALL_BACKENDS" = "1" ]; then
    for pj in "$ROOT_DIR/plugins"/*/plugin.json; do
      [ -f "$pj" ] || continue
      pname=$(basename "$(dirname "$pj")")
      port=$(get_plugin_backend_port "$pname")
      [ -z "$port" ] && continue
      if ! curl -sf --max-time 3 "http://localhost:$port/healthz" > /dev/null 2>&1; then
        hm_log "Plugin $pname health check FAILED (port $port)"
        [ "$MONITOR_RESTART" = "1" ] && restart_plugin_backend "$pname" "$port"
      fi
    done
  fi

  # Use sleep-in-background + wait so SIGTERM is delivered immediately
  # (bash doesn't process traps while waiting for a foreground command)
  sleep "$MONITOR_INTERVAL" &
  _SLEEP_PID=$!
  wait "$_SLEEP_PID" 2>/dev/null || true
  _SLEEP_PID=""
done
