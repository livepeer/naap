#!/bin/bash
# AgentBook Telegram Dev Setup
# Starts cloudflare tunnel and registers Telegram webhook
#
# Usage: ./agentbook/start-telegram.sh

set -e

# Source .env.local for bot token (looks in apps/web-next/.env.local)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../apps/web-next/.env.local"
if [ -f "$ENV_FILE" ]; then
  export $(grep -E '^TELEGRAM_BOT_TOKEN=|^TELEGRAM_WEBHOOK_SECRET=' "$ENV_FILE" | xargs)
fi

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN not set — add it to apps/web-next/.env.local}"
WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-agentbook-webhook-secret-2026}"
LOCAL_PORT=3000

echo "🤖 AgentBook Telegram Dev Setup"
echo "================================"

# Kill any existing tunnel
pkill -f cloudflared 2>/dev/null || true
sleep 1

# Start cloudflare tunnel
echo "🌐 Starting cloudflare tunnel on port $LOCAL_PORT..."
cloudflared tunnel --url http://localhost:$LOCAL_PORT > /tmp/cloudflared.log 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL
for i in {1..15}; do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ Failed to get tunnel URL. Check /tmp/cloudflared.log"
  exit 1
fi

echo "✅ Tunnel: $TUNNEL_URL"

# Register webhook
echo "📡 Registering Telegram webhook..."
RESULT=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${TUNNEL_URL}/api/v1/agentbook/telegram/webhook\",
    \"secret_token\": \"${WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"]
  }")

OK=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null)

if [ "$OK" = "True" ]; then
  echo "✅ Webhook registered"
else
  echo "❌ Webhook registration failed: $RESULT"
  exit 1
fi

# Verify
echo ""
echo "================================"
echo "🤖 Bot: @Agentbookdev_bot"
echo "🌐 Tunnel: $TUNNEL_URL"
echo "📡 Webhook: ${TUNNEL_URL}/api/v1/agentbook/telegram/webhook"
echo "🔑 Mapped to Maya's account"
echo ""
echo "Test: Send /start to @Agentbookdev_bot in Telegram"
echo ""
echo "To stop: pkill -f cloudflared"
echo "================================"
