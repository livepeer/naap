#!/bin/bash
# Keep Cloudflare tunnel alive and auto-register Telegram webhook.
# Usage: ./agentbook/keep-tunnel-alive.sh &
#
# For production, use a named Cloudflare tunnel instead (see CLAUDE.md).

set -euo pipefail
source "$(dirname "$0")/../apps/web-next/.env.local" 2>/dev/null || true

LOCAL_PORT=${LOCAL_PORT:-3000}
CHECK_INTERVAL=${CHECK_INTERVAL:-60}  # seconds between health checks
TUNNEL_PID=""
CURRENT_URL=""

cleanup() {
  echo "[tunnel] Shutting down..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

start_tunnel() {
  # Kill any existing tunnel
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  sleep 1

  # Start new tunnel, capture URL from output
  cloudflared tunnel --url "http://localhost:$LOCAL_PORT" 2>&1 &
  TUNNEL_PID=$!

  # Wait for URL to appear in metrics
  for i in $(seq 1 15); do
    sleep 2
    CURRENT_URL=$(curl -s http://127.0.0.1:20241/metrics 2>/dev/null | grep -o "https://[^ ]*trycloudflare.com" | head -1 || true)
    [ -n "$CURRENT_URL" ] && break
  done

  if [ -z "$CURRENT_URL" ]; then
    echo "[tunnel] ERROR: Could not get tunnel URL after 30s"
    return 1
  fi

  echo "[tunnel] Tunnel URL: $CURRENT_URL"

  # Register with Telegram
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    WEBHOOK_URL="${CURRENT_URL}/api/v1/agentbook/telegram/webhook"
    RESULT=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D&secret_token=${TELEGRAM_WEBHOOK_SECRET:-}")
    echo "[tunnel] Webhook registered: $RESULT"
  fi
}

check_health() {
  # Check if tunnel process is alive
  if [ -n "$TUNNEL_PID" ] && ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[tunnel] Tunnel process died, restarting..."
    return 1
  fi

  # Check if webhook is responding
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    ERROR=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | python3 -c "import json,sys; d=json.load(sys.stdin)['result']; print(d.get('last_error_message',''))" 2>/dev/null || echo "check_failed")
    if echo "$ERROR" | grep -qi "530\|wrong response\|connection"; then
      echo "[tunnel] Webhook unhealthy: $ERROR"
      return 1
    fi
  fi

  return 0
}

# Initial start
echo "[tunnel] Starting Cloudflare tunnel for localhost:$LOCAL_PORT"
start_tunnel

# Monitor loop
while true; do
  sleep "$CHECK_INTERVAL"
  if ! check_health; then
    echo "[tunnel] Health check failed, restarting tunnel..."
    start_tunnel
  fi
done
