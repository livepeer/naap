#!/usr/bin/env bash
# Test the public developer API routes under /api/v1/{network,orchestrators,gpus,capacity,pipelines,pricing}.
#
# Usage:
#   ./scripts/test-public-developer-api.sh
#   BASE_URL=http://127.0.0.1:3000 ./scripts/test-public-developer-api.sh
#
# Prerequisites: web-next dev server or production build listening on BASE_URL.
# Optional: jq for pretty JSON (falls back to raw output).
# Upstream data: Leaderboard + ClickHouse env must be configured for 200 responses
# (otherwise you may see 503 or empty ClickHouse-backed payloads).

set -u

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
PREFIX="${BASE_URL}/api/v1"

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

section() {
  printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  printf ' %s\n' "$1"
  printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
}

# GET url -> prints URL, HTTP status, body (pretty if jq)
curl_json() {
  local url=$1
  printf '\n→ GET %s\n' "$url"
  local tmp out code
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' "$url" || echo "000")
  printf '  HTTP %s\n' "$code"
  pretty <"$tmp"
  rm -f "$tmp"
}

main() {
  section "Public developer API smoke test"
  printf 'BASE_URL=%s\n' "$BASE_URL"

  curl_json "${PREFIX}/network?timeframe=18"
  curl_json "${PREFIX}/orchestrators?period=24h"

  local orch_json addr
  orch_json=$(curl -sS "${PREFIX}/orchestrators?period=24h" || true)
  if command -v jq >/dev/null 2>&1; then
    addr=$(echo "$orch_json" | jq -r 'if type == "array" and length > 0 then .[0].address else empty end' 2>/dev/null || true)
  else
    addr=""
  fi

  if [[ -n "${addr:-}" ]]; then
    curl_json "${PREFIX}/orchestrators/${addr}?period=24h"
  else
    section "GET /api/v1/orchestrators/[address] (skipped)"
    printf 'No address from list (empty array, non-200, or jq missing). Try:\n'
    printf '  curl -sS "%s/orchestrators/0xYourAddress?period=24h"\n' "$PREFIX"
    curl_json "${PREFIX}/orchestrators/0x0000000000000000000000000000000000000001?period=24h"
  fi

  curl_json "${PREFIX}/gpus"
  curl_json "${PREFIX}/capacity"
  curl_json "${PREFIX}/pipelines"
  curl_json "${PREFIX}/pipelines?pipeline=live-video-to-video"
  curl_json "${PREFIX}/pricing"
  curl_json "${PREFIX}/pricing?pipeline=live-video-to-video"
  curl_json "${PREFIX}/pricing?model=streamdiffusion-sdxl"
  curl_json "${PREFIX}/pricing?pipeline=live-video-to-video&model=streamdiffusion-sdxl"

  section "Done"
  printf 'If HTTP 503: check server logs and LEADERBOARD_API_URL / ClickHouse env on the Next server.\n'
}

main "$@"
