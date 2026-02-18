#!/bin/bash
#
# E2E Test: Plugin Publisher
# - Builds all example plugins (naap-plugin build)
# - Packages all (naap-plugin package)
# - Publishes to registry (if NAAP_REGISTRY_URL + NAAP_REGISTRY_TOKEN set)
# - Verifies published plugins appear in marketplace listing
#
# Prerequisites:
#   - npm install from repo root
#   - For publish/verify: base-svc running, NAAP_REGISTRY_TOKEN (JWT from login)
#
# Usage:
#   ./bin/e2e-plugin-publisher.sh              # build + package only
#   ./bin/e2e-plugin-publisher.sh --publish    # also publish + verify (needs token)
#   E2E_AUTH_EMAIL=test@test.com E2E_AUTH_PASSWORD=xxx ./bin/e2e-plugin-publisher.sh --publish
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
EXAMPLES_DIR="$ROOT_DIR/examples"
CLI="$ROOT_DIR/node_modules/.bin/naap-plugin"
# Fallback to dist if CLI not in node_modules (e.g. after npm run build in plugin-sdk)
[ ! -x "$CLI" ] && CLI="node $ROOT_DIR/packages/plugin-sdk/dist/cli/index.js"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

# Ensure plugin-sdk is built (output may be dist/plugin-sdk/cli or dist/cli)
ensure_cli() {
  local CLI_JS="$ROOT_DIR/packages/plugin-sdk/dist/plugin-sdk/cli/index.js"
  [ ! -f "$CLI_JS" ] && CLI_JS="$ROOT_DIR/packages/plugin-sdk/dist/cli/index.js"
  if [ ! -f "$CLI_JS" ]; then
    log_info "Building plugin-sdk..."
    (cd "$ROOT_DIR" && npm run build --workspace=@naap/plugin-sdk) || {
      log_error "Failed to build plugin-sdk";
      exit 1;
    }
    CLI_JS="$ROOT_DIR/packages/plugin-sdk/dist/plugin-sdk/cli/index.js"
    [ ! -f "$CLI_JS" ] && CLI_JS="$ROOT_DIR/packages/plugin-sdk/dist/cli/index.js"
  fi
  CLI="node $CLI_JS"
}

# Discover example plugins
EXAMPLES=()
for d in "$EXAMPLES_DIR"/*/; do
  name=$(basename "$d")
  [ -f "$d/plugin.json" ] && EXAMPLES+=("$name")
done
IFS=$'\n' EXAMPLES=($(sort <<<"${EXAMPLES[*]}")); unset IFS

if [ ${#EXAMPLES[@]} -eq 0 ]; then
  log_error "No example plugins found in $EXAMPLES_DIR"
  exit 1
fi

log_info "Found ${#EXAMPLES[@]} example plugins: ${EXAMPLES[*]}"

ensure_cli

# Parse args
DO_PUBLISH=false
for arg in "$@"; do
  [ "$arg" = "--publish" ] && DO_PUBLISH=true
done

# Build plugin-build if needed (for frontend Vite)
if [ ! -f "$ROOT_DIR/packages/plugin-build/dist/vite.js" ]; then
  log_info "Building @naap/plugin-build..."
  (cd "$ROOT_DIR" && npx tsc -p packages/plugin-build/tsconfig.json) || { log_error "plugin-build failed"; exit 1; }
fi

export NODE_PATH="$ROOT_DIR/node_modules${NODE_PATH:+:$NODE_PATH}"

###############################################################################
# Phase 0: Ensure example dependencies are installed
###############################################################################
log_section "Phase 0: Install example dependencies"

for name in "${EXAMPLES[@]}"; do
  dir="$EXAMPLES_DIR/$name"
  [ -d "$dir/frontend" ] && (cd "$dir/frontend" && npm install --silent 2>/dev/null) || true
  [ -d "$dir/backend" ] && (cd "$dir/backend" && npm install --silent 2>/dev/null) || true
done
log_success "Dependencies installed"

###############################################################################
# Phase 1: Build all examples
###############################################################################
log_section "Phase 1: Build all example plugins"

BUILD_OK=0
BUILD_FAIL=0
BUILD_FAILED_NAMES=()

for name in "${EXAMPLES[@]}"; do
  dir="$EXAMPLES_DIR/$name"
  log_info "Building $name..."
  if (cd "$dir" && $CLI build --skip-security 2>&1); then
    log_success "Built $name"
    BUILD_OK=$((BUILD_OK + 1))
  else
    log_error "Build failed: $name"
    BUILD_FAIL=$((BUILD_FAIL + 1))
    BUILD_FAILED_NAMES+=("$name")
  fi
done

if [ $BUILD_FAIL -gt 0 ]; then
  log_error "Build phase failed for: ${BUILD_FAILED_NAMES[*]}"
  exit 1
fi

log_success "All ${#EXAMPLES[@]} plugins built successfully"

###############################################################################
# Phase 2: Package all
###############################################################################
log_section "Phase 2: Package all example plugins"

PACK_OK=0
PACK_FAIL=0
PACK_FAILED_NAMES=()

for name in "${EXAMPLES[@]}"; do
  dir="$EXAMPLES_DIR/$name"
  log_info "Packaging $name..."
  if (cd "$dir" && $CLI package 2>&1); then
    log_success "Packaged $name"
    PACK_OK=$((PACK_OK + 1))
  else
    log_error "Package failed: $name"
    PACK_FAIL=$((PACK_FAIL + 1))
    PACK_FAILED_NAMES+=("$name")
  fi
done

if [ $PACK_FAIL -gt 0 ]; then
  log_error "Package phase failed for: ${PACK_FAILED_NAMES[*]}"
  exit 1
fi

log_success "All ${#EXAMPLES[@]} plugins packaged successfully"

###############################################################################
# Phase 3: Publish + Verify (optional)
###############################################################################
REGISTRY_URL="${NAAP_REGISTRY_URL:-${E2E_REGISTRY_URL:-}}"
TOKEN="${NAAP_REGISTRY_TOKEN:-${E2E_REGISTRY_TOKEN:-}}"

# Optional: obtain token via login
if [ "$DO_PUBLISH" = true ] && [ -z "$TOKEN" ] && [ -n "${E2E_AUTH_EMAIL:-}" ] && [ -n "${E2E_AUTH_PASSWORD:-}" ]; then
  REGISTRY_URL="${REGISTRY_URL:-http://localhost:4000}"
  log_info "Obtaining token via login..."
  LOGIN_RESP=$(curl -s -X POST "$REGISTRY_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$E2E_AUTH_EMAIL\",\"password\":\"$E2E_AUTH_PASSWORD\"}") || true
  TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | sed 's/"token":"\([^"]*\)"/\1/')
  if [ -z "$TOKEN" ]; then
    log_warn "Login failed or no token in response. Set NAAP_REGISTRY_TOKEN manually."
  else
    log_success "Obtained token"
  fi
fi

if [ "$DO_PUBLISH" != true ]; then
  log_section "Done (build + package only)"
  echo ""
  echo "To run publish + marketplace verification:"
  echo "  1. Start base-svc: ./bin/start.sh"
  echo "  2. Create a user and get JWT (login via UI or POST /api/v1/auth/login)"
  echo "  3. Run: NAAP_REGISTRY_URL=http://localhost:4000 NAAP_REGISTRY_TOKEN=<jwt> ./bin/e2e-plugin-publisher.sh --publish"
  echo ""
  exit 0
fi

if [ -z "$REGISTRY_URL" ]; then
  REGISTRY_URL="http://localhost:4000"
  log_info "Using default registry: $REGISTRY_URL"
fi

if [ -z "$TOKEN" ]; then
  log_error "Publish requires NAAP_REGISTRY_TOKEN (or E2E_AUTH_EMAIL + E2E_AUTH_PASSWORD for auto-login)"
  exit 1
fi

log_section "Phase 3: Publish to registry"

PUBLISH_OK=0
PUBLISH_FAIL=0
PUBLISHED_NAMES=()

for name in "${EXAMPLES[@]}"; do
  dir="$EXAMPLES_DIR/$name"
  # Get plugin name from manifest (might differ from dir name)
  PLUGIN_NAME=$(node -e "console.log(require('$dir/plugin.json').name)" 2>/dev/null || echo "$name")
  log_info "Publishing $PLUGIN_NAME..."
  if (cd "$dir" && NAAP_REGISTRY_URL="$REGISTRY_URL" NAAP_REGISTRY_TOKEN="$TOKEN" $CLI publish 2>&1); then
    log_success "Published $PLUGIN_NAME"
    PUBLISH_OK=$((PUBLISH_OK + 1))
    PUBLISHED_NAMES+=("$PLUGIN_NAME")
  else
    log_error "Publish failed: $PLUGIN_NAME"
    PUBLISH_FAIL=$((PUBLISH_FAIL + 1))
  fi
done

if [ $PUBLISH_FAIL -gt 0 ]; then
  log_error "Publish phase failed for $PUBLISH_FAIL plugin(s)"
  exit 1
fi

###############################################################################
# Phase 4: Verify marketplace listing
###############################################################################
log_section "Phase 4: Verify marketplace listing"

# Packages API: GET /api/v1/registry/packages
# Try registry URL first (base-svc), fallback to common ports
PACKAGES_URL="$REGISTRY_URL/api/v1/registry/packages"
# For Next.js proxy setup, packages might be at :3000
if [[ "$REGISTRY_URL" == *":4000"* ]]; then
  NEXT_URL="http://localhost:3000/api/v1/registry/packages"
else
  NEXT_URL="$PACKAGES_URL"
fi

RESP=$(curl -s "${PACKAGES_URL}?pageSize=100" 2>/dev/null) || RESP=""
if [ -z "$RESP" ]; then
  RESP=$(curl -s "${NEXT_URL}?pageSize=100" 2>/dev/null) || true
fi

if [ -z "$RESP" ]; then
  log_error "Could not fetch registry packages (tried $PACKAGES_URL and $NEXT_URL)"
  exit 1
fi

# Extract package names from JSON (simple grep/sed - works for "name":"xxx")
LISTED_NAMES=$(echo "$RESP" | grep -o '"name":"[^"]*"' | sed 's/"name":"\([^"]*\)"/\1/g' | tr '\n' ' ')

MISSING=()
for n in "${PUBLISHED_NAMES[@]}"; do
  if echo " $LISTED_NAMES " | grep -q " $n "; then
    log_success "  $n ✓"
  else
    log_error "  $n MISSING from marketplace"
    MISSING+=("$n")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  log_error "Marketplace verification failed: ${MISSING[*]} not listed"
  exit 1
fi

log_success "All ${#PUBLISHED_NAMES[@]} published plugins appear in marketplace"
echo ""
log_success "E2E Plugin Publisher: all phases passed"
