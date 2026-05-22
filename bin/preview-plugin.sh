#!/bin/bash
#
# preview-plugin.sh — Configure an experimental plugin for preview testing
#
# Works against both local dev and Vercel preview deployments.
#
# Usage:
#   ./bin/preview-plugin.sh <plugin-name> [options]
#
# Options:
#   --testers "id1,email@example.com"   Add preview testers (user IDs or emails)
#   --hide                              Hide from all non-admin users (clear testers)
#   --publish                           Make visible to all users (graduate from preview)
#   --url <base-url>                    Target URL (default: http://localhost:3000)
#   --token <session-token>             Admin session token (required for remote URLs)
#   --status                            Show current visibility status only
#   --help                              Show this help
#
# Examples:
#   # Local: register + add yourself as tester
#   ./bin/preview-plugin.sh orchestrator-leaderboard --testers "admin@livepeer.org"
#
#   # Vercel preview: configure remotely
#   ./bin/preview-plugin.sh orchestrator-leaderboard \
#     --url "https://naap-git-feat-xxx-livepeer.vercel.app" \
#     --token "<admin-session-token>" \
#     --testers "user@example.com"
#
#   # Graduate: make visible to everyone
#   ./bin/preview-plugin.sh orchestrator-leaderboard --publish

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

# Defaults
BASE_URL="${PREVIEW_PLUGIN_URL:-http://localhost:3000}"
TOKEN=""
TESTERS=""
ACTION=""  # testers | hide | publish | status
PLUGIN_NAME=""

show_help() {
  head -35 "$0" | tail -30 | sed 's/^# \?//'
  exit 0
}

# ─── Parse arguments ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --testers)  ACTION="testers"; TESTERS="$2"; shift 2 ;;
    --hide)     ACTION="hide"; shift ;;
    --publish)  ACTION="publish"; shift ;;
    --status)   ACTION="status"; shift ;;
    --url)      BASE_URL="$2"; shift 2 ;;
    --token)    TOKEN="$2"; shift 2 ;;
    --help|-h)  show_help ;;
    -*)         echo -e "${RED}Unknown option: $1${NC}"; show_help ;;
    *)
      if [ -z "$PLUGIN_NAME" ]; then
        PLUGIN_NAME="$1"; shift
      else
        echo -e "${RED}Unexpected argument: $1${NC}"; show_help
      fi ;;
  esac
done

if [ -z "$PLUGIN_NAME" ]; then
  echo -e "${RED}Error: plugin name is required${NC}"
  echo "Usage: ./bin/preview-plugin.sh <plugin-name> [options]"
  exit 1
fi

if [ -z "$ACTION" ]; then
  ACTION="status"
fi

# Convert kebab-case to camelCase for API calls
to_camel() {
  python3 -c "
s='$1'
parts=s.split('-')
print(parts[0] + ''.join(p.capitalize() for p in parts[1:]))
"
}
CAMEL_NAME=$(to_camel "$PLUGIN_NAME")

# ─── Local sync (only if targeting localhost) ─────────────────────────────────

is_local() {
  echo "$BASE_URL" | grep -qE "localhost|127\.0\.0\.1"
}

if is_local && [ "$ACTION" != "status" ]; then
  PLUGIN_JSON="$ROOT_DIR/plugins/$PLUGIN_NAME/plugin.json"
  if [ ! -f "$PLUGIN_JSON" ]; then
    echo -e "${RED}Error: $PLUGIN_JSON not found${NC}"
    echo -e "${DIM}The plugin must have a plugin.json to be discoverable.${NC}"
    exit 1
  fi
  echo -e "${BLUE}[sync]${NC} Registering plugin in local database..."
  cd "$ROOT_DIR"
  SYNC_LOG=$(DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/naap}" \
    npx tsx bin/sync-plugin-registry.ts 2>&1)
  SYNC_RC=$?
  echo "$SYNC_LOG" | grep -E "Discovered|created|updated|Done"
  if [ $SYNC_RC -ne 0 ]; then
    echo -e "${RED}Error: Plugin registry sync failed (exit $SYNC_RC)${NC}"
    echo "$SYNC_LOG" | tail -5
    exit 1
  fi
  echo -e "${GREEN}[sync]${NC} Plugin registry synced"
fi

# ─── Obtain auth token ────────────────────────────────────────────────────────

if [ -z "$TOKEN" ] && is_local; then
  echo -e "${BLUE}[auth]${NC} Logging in as admin@livepeer.org..."
  LOGIN_RESP=$(curl -sf -X POST "$BASE_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@livepeer.org","password":"livepeer"}' 2>/dev/null || echo "")
  if [ -n "$LOGIN_RESP" ]; then
    TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null || echo "")
  fi
  if [ -z "$TOKEN" ]; then
    echo -e "${RED}Error: Failed to obtain admin token. Is the server running?${NC}"
    exit 1
  fi
  echo -e "${GREEN}[auth]${NC} Authenticated"
elif [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: --token is required for remote URLs${NC}"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ─── Fetch current state ─────────────────────────────────────────────────────

CURRENT=$(curl -sf "$BASE_URL/api/v1/admin/plugins/core" -H "$AUTH_HEADER" 2>/dev/null || echo "")
if [ -z "$CURRENT" ]; then
  echo -e "${RED}Error: Failed to fetch plugin list from $BASE_URL${NC}"
  exit 1
fi

# Extract current core plugins
CORE_NAMES=$(echo "$CURRENT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
names=[p['name'] for p in d.get('data',{}).get('plugins',[]) if p.get('isCore')]
print(','.join(names))
" 2>/dev/null)

HIDDEN_NAMES=$(echo "$CURRENT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
names=[p['name'] for p in d.get('data',{}).get('plugins',[]) if not p.get('visibleToUsers')]
print(','.join(names))
" 2>/dev/null)

# Show current status
show_status() {
  echo ""
  echo -e "${BOLD}Plugin: $PLUGIN_NAME ($CAMEL_NAME)${NC}"
  echo "$CURRENT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
target=sys.argv[1]
found=False
for p in d.get('data',{}).get('plugins',[]):
    if p['name'] == target:
        found=True
        print(f\"  isCore:         {p.get('isCore', False)}\")
        print(f\"  visibleToUsers: {p.get('visibleToUsers', True)}\")
        testers = p.get('previewTesterUserIds', [])
        print(f\"  previewTesters: {testers if testers else '(none)'}\")
        break
if not found:
    print('  NOT FOUND in plugin list')
" "$CAMEL_NAME" 2>/dev/null
  echo ""
}

if [ "$ACTION" = "status" ]; then
  show_status
  exit 0
fi

# ─── Build the PUT payload ────────────────────────────────────────────────────

# Ensure the plugin is in the core list
if ! echo ",$CORE_NAMES," | grep -q ",$CAMEL_NAME,"; then
  CORE_NAMES="$CORE_NAMES,$CAMEL_NAME"
fi

case "$ACTION" in
  testers)
    # Add to hidden list if not already there
    if ! echo ",$HIDDEN_NAMES," | grep -q ",$CAMEL_NAME,"; then
      HIDDEN_NAMES="$HIDDEN_NAMES,$CAMEL_NAME"
    fi
    TESTERS_JSON=$(python3 -c "
import json, sys
testers = [t.strip() for t in sys.argv[1].split(',') if t.strip()]
print(json.dumps({sys.argv[2]: testers}))
" "$TESTERS" "$CAMEL_NAME")
    ;;
  hide)
    if ! echo ",$HIDDEN_NAMES," | grep -q ",$CAMEL_NAME,"; then
      HIDDEN_NAMES="$HIDDEN_NAMES,$CAMEL_NAME"
    fi
    TESTERS_JSON="{\"$CAMEL_NAME\": []}"
    ;;
  publish)
    # Remove from hidden list
    HIDDEN_NAMES=$(echo "$HIDDEN_NAMES" | tr ',' '\n' | grep -v "^${CAMEL_NAME}$" | tr '\n' ',' | sed 's/,$//')
    TESTERS_JSON="{}"
    ;;
esac

# Convert comma-separated to JSON arrays
CORE_JSON=$(python3 -c "
import json, sys
names = [n.strip() for n in sys.argv[1].split(',') if n.strip()]
print(json.dumps(names))
" "$CORE_NAMES")
HIDDEN_JSON=$(python3 -c "
import json, sys
names = [n.strip() for n in sys.argv[1].split(',') if n.strip()]
print(json.dumps(names))
" "$HIDDEN_NAMES")

PAYLOAD=$(python3 -c "
import json
payload = {
    'corePluginNames': json.loads('$CORE_JSON'),
    'hiddenPluginNames': json.loads('$HIDDEN_JSON'),
    'previewTesterUserIdsByPlugin': json.loads('$TESTERS_JSON'),
}
print(json.dumps(payload, indent=2))
")

echo -e "${BLUE}[config]${NC} Updating plugin configuration..."
RESULT=$(curl -sf -X PUT "$BASE_URL/api/v1/admin/plugins/core" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || echo "")

if [ -z "$RESULT" ]; then
  echo -e "${RED}Error: Failed to update plugin configuration${NC}"
  exit 1
fi

MSG=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('message','Updated'))" 2>/dev/null)
echo -e "${GREEN}[config]${NC} $MSG"

# Refresh and show final status
CURRENT=$(curl -sf "$BASE_URL/api/v1/admin/plugins/core" -H "$AUTH_HEADER" 2>/dev/null || echo "$RESULT")
show_status

echo -e "${DIM}Plugin URL: $BASE_URL/plugins/$PLUGIN_NAME${NC}"
