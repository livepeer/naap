#!/usr/bin/env bash
#
# Orchestrator Leaderboard — Client Test Script
#
# Usage:
#   export NAAP_API_URL=https://your-naap-host
#   export API_KEY=gw_your_api_key
#   bash client-test.sh
#

set -euo pipefail

API_URL="${NAAP_API_URL:-http://localhost:3000}"
AUTH="Authorization: Bearer ${API_KEY:?Set API_KEY env var}"

echo "=== 1. Get available capabilities ==="
curl -s -H "$AUTH" \
  "$API_URL/api/v1/orchestrator-leaderboard/filters" | jq

echo ""
echo "=== 2. Get top 5 orchestrators for streamdiffusion-sdxl (default ranking) ==="
curl -s -X POST \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"capability":"streamdiffusion-sdxl","topN":5}' \
  "$API_URL/api/v1/orchestrator-leaderboard/rank" | jq

echo ""
echo "=== 3. With post-filters and custom SLA weights ==="
curl -s -X POST \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "capability":"streamdiffusion-sdxl",
    "topN":10,
    "filters":{"gpuRamGbMin":16,"maxAvgLatencyMs":500,"maxSwapRatio":0.3},
    "slaWeights":{"latency":0.5,"swapRate":0.3,"price":0.2}
  }' \
  "$API_URL/api/v1/orchestrator-leaderboard/rank" | jq

echo ""
echo "=== 4. Extract just orchestrator URLs ==="
curl -s -X POST \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"capability":"streamdiffusion-sdxl","topN":5}' \
  "$API_URL/api/v1/orchestrator-leaderboard/rank" | jq '.data[].orchUri'

echo ""
echo "=== 5. Check cache headers (requires curl >= 7.83.0) ==="
curl -s -o /dev/null -w "X-Cache: %header{X-Cache}\nX-Cache-Age: %header{X-Cache-Age}\nX-Data-Freshness: %header{X-Data-Freshness}\nCache-Control: %header{Cache-Control}\n" \
  -X POST \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{"capability":"streamdiffusion-sdxl","topN":5}' \
  "$API_URL/api/v1/orchestrator-leaderboard/rank"
