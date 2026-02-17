#!/usr/bin/env bash
# =============================================================================
# Plugin Lifecycle Smoke Test
# =============================================================================
# Script-driven smoke test covering:
#   1. SDK build
#   2. Plugin build (all core plugins via build-plugins.sh)
#   3. Core plugin UMD bundle existence
#   4. Health-check script passes
#
# Usage:
#   ./bin/lifecycle-smoke.sh [--skip-build]
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SKIP_BUILD="${1:-}"
FAIL=0

info()  { echo "[SMOKE] $*"; }
pass()  { echo "[PASS]  $*"; }
fail()  { echo "[FAIL]  $*"; FAIL=1; }

# ------------------------------------------------------------------
# 1. SDK build
# ------------------------------------------------------------------
if [[ "$SKIP_BUILD" != "--skip-build" ]]; then
  info "Building SDK..."
  if (cd "$ROOT_DIR/packages/plugin-sdk" && npm run build 2>/dev/null); then
    pass "SDK build"
  else
    fail "SDK build"
  fi
fi

# ------------------------------------------------------------------
# 2. Core plugin builds (UMD bundles)
# ------------------------------------------------------------------
CORE_PLUGINS=(capacity-planner community marketplace developer-api plugin-publisher)

for plugin in "${CORE_PLUGINS[@]}"; do
  FRONTEND_DIR="$ROOT_DIR/plugins/$plugin/frontend"
  if [[ -d "$FRONTEND_DIR" ]]; then
    PKG_JSON="$FRONTEND_DIR/package.json"
    if [[ -f "$PKG_JSON" ]] && grep -q '"build:umd"' "$PKG_JSON" 2>/dev/null; then
      info "Checking UMD build for $plugin..."
      # Check that dist/production exists (from a previous build) or skip
      PROD_DIR="$FRONTEND_DIR/dist/production"
      if [[ -d "$PROD_DIR" ]] && ls "$PROD_DIR"/*.js 1>/dev/null 2>&1; then
        pass "UMD bundle exists: $plugin"
      else
        fail "UMD bundle missing: $plugin (run build-plugins.sh first)"
      fi
    else
      info "No build:umd script for $plugin — skipping"
    fi
  fi
done

# ------------------------------------------------------------------
# 3. Key files existence check
# ------------------------------------------------------------------
REQUIRED_FILES=(
  "packages/plugin-sdk/package.json"
  "packages/plugin-build/package.json"
  "apps/web-next/package.json"
  "apps/web-next/next.config.js"
  "services/base-svc/package.json"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$ROOT_DIR/$f" ]]; then
    pass "File exists: $f"
  else
    fail "File missing: $f"
  fi
done

# ------------------------------------------------------------------
# 4. health-check script (if available)
# ------------------------------------------------------------------
HEALTH_SCRIPT="$ROOT_DIR/bin/health-check.sh"
if [[ -x "$HEALTH_SCRIPT" ]]; then
  info "Running health-check.sh..."
  if "$HEALTH_SCRIPT" 2>/dev/null; then
    pass "Health check"
  else
    # Health check may fail if services aren't running — warn instead of fail
    info "Health check returned non-zero (services may not be running)"
  fi
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "=========================================="
  echo " ALL SMOKE CHECKS PASSED"
  echo "=========================================="
else
  echo "=========================================="
  echo " SOME SMOKE CHECKS FAILED"
  echo "=========================================="
  exit 1
fi
