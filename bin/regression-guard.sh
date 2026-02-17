#!/usr/bin/env bash
# =============================================================================
# Plugin Regression Guard
# =============================================================================
# Validates that all core plugins and the SDK remain compatible after changes.
# Run this before every merge to detect breaking regressions.
#
# Checks:
#   1. SDK builds successfully
#   2. Each core plugin frontend: installs + builds (UMD) + tests
#   3. Key structural files exist
#
# Usage:
#   ./bin/regression-guard.sh
#
# Exit codes:
#   0 = all checks passed
#   1 = regression detected
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CORE_PLUGINS=(capacity-planner community marketplace developer-api plugin-publisher)
FAIL=0
TOTAL=0
PASSED=0

info()  { echo ""; echo "[GUARD] $*"; }
pass()  { echo "  [PASS] $*"; PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); }
fail()  { echo "  [FAIL] $*"; FAIL=1; TOTAL=$((TOTAL + 1)); }
skip()  { echo "  [SKIP] $*"; }

# ------------------------------------------------------------------
# 1. SDK Build
# ------------------------------------------------------------------
info "1. SDK Build Check"
if (cd "$ROOT_DIR/packages/plugin-sdk" && npm run build 2>&1 >/dev/null); then
  pass "packages/plugin-sdk builds"
else
  fail "packages/plugin-sdk build failed"
fi

# ------------------------------------------------------------------
# 2. Core Plugin Compatibility
# ------------------------------------------------------------------
info "2. Core Plugin Compatibility Matrix"
for plugin in "${CORE_PLUGINS[@]}"; do
  FRONTEND_DIR="$ROOT_DIR/plugins/$plugin/frontend"

  if [[ ! -d "$FRONTEND_DIR" ]]; then
    skip "$plugin — no frontend directory"
    continue
  fi

  # Check package.json exists
  if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
    fail "$plugin — missing package.json"
    continue
  fi

  # TypeScript check (if tsc configured)
  if grep -q '"typecheck"' "$FRONTEND_DIR/package.json" 2>/dev/null; then
    if (cd "$FRONTEND_DIR" && npm run typecheck 2>&1 >/dev/null); then
      pass "$plugin — typecheck"
    else
      fail "$plugin — typecheck failed"
    fi
  fi

  # Test (if configured)
  if grep -q '"test"' "$FRONTEND_DIR/package.json" 2>/dev/null; then
    if (cd "$FRONTEND_DIR" && npm test --if-present 2>&1 >/dev/null); then
      pass "$plugin — tests"
    else
      fail "$plugin — tests failed"
    fi
  else
    skip "$plugin — no test script"
  fi

  # UMD build (if configured)
  if grep -q '"build:umd"' "$FRONTEND_DIR/package.json" 2>/dev/null; then
    if (cd "$FRONTEND_DIR" && npm run build:umd 2>&1 >/dev/null); then
      pass "$plugin — UMD build"
    else
      fail "$plugin — UMD build failed"
    fi
  else
    skip "$plugin — no build:umd script"
  fi
done

# ------------------------------------------------------------------
# 3. Structural Integrity
# ------------------------------------------------------------------
info "3. Structural Integrity"
REQUIRED_FILES=(
  "packages/plugin-sdk/package.json"
  "packages/plugin-sdk/cli/index.ts"
  "packages/plugin-build/package.json"
  "apps/web-next/package.json"
  "apps/web-next/next.config.js"
  "services/base-svc/package.json"
  ".github/workflows/ci.yml"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$ROOT_DIR/$f" ]]; then
    pass "File: $f"
  else
    fail "Missing: $f"
  fi
done

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "=========================================="
echo " Regression Guard: $PASSED/$TOTAL passed"
echo "=========================================="

if [[ "$FAIL" -eq 0 ]]; then
  echo " NO REGRESSIONS DETECTED"
  exit 0
else
  echo " REGRESSIONS DETECTED — fix before merge"
  exit 1
fi
