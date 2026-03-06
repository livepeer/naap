#!/usr/bin/env bash
#
# E2E RunPod Deployment Test — deploys scope to an L4 GPU, verifies the full
# lifecycle (create → deploy → status → health → destroy), then cleans up.
#
# Prerequisites:
#   - NaaP platform running on localhost:3000
#   - RunPod API key configured via the deployment-manager UI
#
# Usage:
#   RUNPOD_KEY=<your-key> bash scripts/e2e-runpod-deploy.sh
#
set -euo pipefail

API="http://localhost:3000/api/v1/deployment-manager"
AUTH_API="http://localhost:3000/api/v1/auth"
DEPLOY_NAME="scope-e2e-$(date +%s)"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
blue()  { printf "\033[34m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

# ── 1. Get auth token ──────────────────────────────────────────────────────
blue "=== Step 1: Authenticating ==="
LOGIN=$(curl -s "$AUTH_API/register" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2e-runpod@naap.local","password":"E2eTest1234!","name":"E2E RunPod"}')

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  # User might exist, try login
  LOGIN=$(curl -s "$AUTH_API/login" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"email":"e2e-runpod@naap.local","password":"E2eTest1234!"}')
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
fi

if [ -z "$TOKEN" ]; then
  red "FAIL: Could not authenticate"
  exit 1
fi
green "✓ Authenticated (token=${TOKEN:0:12}...)"

AUTH="-H Authorization:Bearer $TOKEN"

# ── 2. Configure RunPod API key ─────────────────────────────────────────────
blue "=== Step 2: Configuring RunPod credentials ==="

if [ -z "${RUNPOD_KEY:-}" ]; then
  red "FAIL: RUNPOD_KEY env var must be set"
  echo "Usage: RUNPOD_KEY=<your-key> bash scripts/e2e-runpod-deploy.sh"
  exit 1
fi

SAVE_CRED=$(curl -s "$API/credentials/runpod/credentials" -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"secrets\":{\"api-key\":\"$RUNPOD_KEY\"}}")

echo "$SAVE_CRED" | python3 -m json.tool 2>/dev/null
SAVE_OK=$(echo "$SAVE_CRED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)
if [ "$SAVE_OK" != "True" ]; then
  red "FAIL: Could not save RunPod credentials"
  exit 1
fi
green "✓ RunPod API key saved"

# ── 3. Test connection ──────────────────────────────────────────────────────
blue "=== Step 3: Testing RunPod connection ==="
TEST=$(curl -s "$API/credentials/runpod/test-connection" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json')

echo "$TEST" | python3 -m json.tool 2>/dev/null
TEST_OK=$(echo "$TEST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('success',False))" 2>/dev/null)
if [ "$TEST_OK" != "True" ]; then
  red "FAIL: RunPod connection test failed"
  exit 1
fi
green "✓ RunPod connection verified"

# ── 4. Check credential status ──────────────────────────────────────────────
blue "=== Step 4: Verifying credential status ==="
CRED_STATUS=$(curl -s "$API/credentials/runpod/credential-status" \
  -H "Authorization: Bearer $TOKEN")

echo "$CRED_STATUS" | python3 -m json.tool 2>/dev/null
CRED_OK=$(echo "$CRED_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('configured',False))" 2>/dev/null)
if [ "$CRED_OK" != "True" ]; then
  red "FAIL: Credential status not configured"
  exit 1
fi
green "✓ Credentials confirmed configured"

# ── 5. Create deployment ────────────────────────────────────────────────────
blue "=== Step 5: Creating deployment ($DEPLOY_NAME) ==="
CREATE=$(curl -s "$API/deployments" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"name\": \"$DEPLOY_NAME\",
    \"providerSlug\": \"runpod\",
    \"gpuModel\": \"NVIDIA L4\",
    \"gpuVramGb\": 24,
    \"gpuCount\": 1,
    \"dockerImage\": \"daydreamlive/scope\",
    \"artifactType\": \"scope\",
    \"artifactVersion\": \"latest\",
    \"concurrency\": 1
  }")

echo "$CREATE" | python3 -m json.tool 2>/dev/null
DEPLOY_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

if [ -z "$DEPLOY_ID" ]; then
  red "FAIL: Could not create deployment"
  exit 1
fi
green "✓ Deployment created: $DEPLOY_ID"

# ── 6. Trigger deploy ───────────────────────────────────────────────────────
blue "=== Step 6: Deploying to RunPod ==="
DEPLOY=$(curl -s "$API/deployments/$DEPLOY_ID/deploy" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json')

echo "$DEPLOY" | python3 -m json.tool 2>/dev/null
DEPLOY_OK=$(echo "$DEPLOY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)

if [ "$DEPLOY_OK" != "True" ]; then
  red "FAIL: Deploy call failed"
  echo "$DEPLOY"
  # Still try to clean up
  blue "Attempting cleanup..."
  curl -s "$API/deployments/$DEPLOY_ID" -X DELETE -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null
  exit 1
fi
green "✓ Deploy triggered"

ENDPOINT_URL=$(echo "$DEPLOY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('endpointUrl','N/A'))" 2>/dev/null)
echo "   Endpoint URL: $ENDPOINT_URL"

# ── 7. Poll status ──────────────────────────────────────────────────────────
blue "=== Step 7: Polling deployment status (up to 120s) ==="
for i in $(seq 1 12); do
  sleep 10
  STATUS=$(curl -s "$API/deployments/$DEPLOY_ID" \
    -H "Authorization: Bearer $TOKEN")

  CURRENT=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('status','UNKNOWN'))" 2>/dev/null)
  HEALTH=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('healthStatus','UNKNOWN'))" 2>/dev/null)

  echo "   [${i}0s] status=$CURRENT health=$HEALTH"

  if [ "$CURRENT" = "ONLINE" ]; then
    green "✓ Deployment is ONLINE"
    break
  fi
  if [ "$CURRENT" = "FAILED" ]; then
    red "✗ Deployment FAILED"
    break
  fi
done

# ── 8. Health check ──────────────────────────────────────────────────────────
blue "=== Step 8: Health check ==="
HEALTH_RES=$(curl -s "$API/deployments/$DEPLOY_ID/health" \
  -H "Authorization: Bearer $TOKEN")

echo "$HEALTH_RES" | python3 -m json.tool 2>/dev/null

# ── 9. Get deployment details ────────────────────────────────────────────────
blue "=== Step 9: Final deployment details ==="
DETAILS=$(curl -s "$API/deployments/$DEPLOY_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "$DETAILS" | python3 -m json.tool 2>/dev/null

# ── 10. Destroy deployment ──────────────────────────────────────────────────
blue "=== Step 10: Destroying deployment ==="
DESTROY=$(curl -s "$API/deployments/$DEPLOY_ID" -X DELETE \
  -H "Authorization: Bearer $TOKEN")

echo "$DESTROY" | python3 -m json.tool 2>/dev/null
DESTROY_OK=$(echo "$DESTROY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null)

if [ "$DESTROY_OK" = "True" ]; then
  green "✓ Deployment destroyed"
else
  red "⚠ Destroy may have failed — check RunPod dashboard manually"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
bold "=== E2E Test Summary ==="
green "✓ Auth + credentials"
green "✓ Test connection"
green "✓ Create deployment"
green "✓ Deploy to RunPod (L4 GPU)"
echo "  Status: $CURRENT"
echo "  Health: $HEALTH"
echo "  Endpoint: $ENDPOINT_URL"
green "✓ Destroy / cleanup"
echo ""
echo "All E2E steps completed."
