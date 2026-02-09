#!/bin/bash
#
# Validate Plugin URL Patterns
#
# Scans plugin frontend source code for common URL construction mistakes
# that break on Vercel deployments. Run this before committing or as
# part of CI.
#
# Usage: ./bin/validate-plugin-urls.sh [--fix]
#
# Exit codes:
#   0 = all clean
#   1 = issues found
#

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

errors=0
warnings=0

echo "========================================================"
echo "  Plugin URL Pattern Validator"
echo "========================================================"
echo ""

# ──────────────────────────────────────────────────────────────
# Check 1: getPluginBackendUrl('...') WITHOUT apiPath, followed
#           by /api/v1/ in the same file = DOUBLED URL on Vercel
# ──────────────────────────────────────────────────────────────
echo "[1/5] Checking for doubled-URL pattern (getPluginBackendUrl without apiPath)..."

while IFS= read -r file; do
  # Check if file has getPluginBackendUrl('xxx') without apiPath
  if grep -qP "getPluginBackendUrl\(['\"][^'\"]+['\"]\s*\)" "$file" 2>/dev/null; then
    # And also has /api/v1/ in a template literal
    if grep -qP '\$\{.*\}/api/v1/' "$file" 2>/dev/null; then
      echo -e "  ${RED}ERROR${NC}: $file"
      echo "    Uses getPluginBackendUrl() without apiPath AND appends /api/v1/ paths."
      echo "    Fix: Use getServiceOrigin() instead, or pass { apiPath: '/api/v1/...' }"
      errors=$((errors + 1))
    fi
  fi
done < <(find plugins/*/frontend/src -name '*.ts' -o -name '*.tsx' 2>/dev/null)

echo ""

# ──────────────────────────────────────────────────────────────
# Check 2: Hardcoded localhost:PORT in non-dev files
# ──────────────────────────────────────────────────────────────
echo "[2/5] Checking for hardcoded localhost:PORT..."

while IFS= read -r file; do
  # Skip main.tsx files (standalone dev mode only)
  [[ "$file" == *"main.tsx"* ]] && continue
  [[ "$file" == *"main.ts"* ]] && continue
  [[ "$file" == *".test."* ]] && continue

  matches=$(grep -nP 'localhost:\d{4}' "$file" 2>/dev/null | grep -v '// dev' | grep -v 'development' || true)
  if [ -n "$matches" ]; then
    echo -e "  ${YELLOW}WARN${NC}: $file"
    echo "$matches" | while IFS= read -r line; do
      echo "    $line"
    done
    warnings=$((warnings + 1))
  fi
done < <(find plugins/*/frontend/src -name '*.ts' -o -name '*.tsx' 2>/dev/null)

echo ""

# ──────────────────────────────────────────────────────────────
# Check 3: window.location.hostname + port concatenation
# ──────────────────────────────────────────────────────────────
echo "[3/5] Checking for manual hostname:port construction..."

while IFS= read -r file; do
  if grep -qP 'window\.location\.(hostname|host).*:\d' "$file" 2>/dev/null; then
    echo -e "  ${YELLOW}WARN${NC}: $file"
    echo "    Manually constructs hostname:port. Use getServiceOrigin() instead."
    warnings=$((warnings + 1))
  fi
done < <(find plugins/*/frontend/src -name '*.ts' -o -name '*.tsx' 2>/dev/null)

echo ""

# ──────────────────────────────────────────────────────────────
# Check 4: Using deprecated getBackendUrl / getApiUrl
# ──────────────────────────────────────────────────────────────
echo "[4/5] Checking for deprecated getBackendUrl/getApiUrl imports..."

while IFS= read -r file; do
  if grep -qP "import.*\b(getBackendUrl|getApiUrl)\b.*from" "$file" 2>/dev/null; then
    echo -e "  ${YELLOW}WARN${NC}: $file"
    echo "    Imports deprecated getBackendUrl/getApiUrl."
    echo "    Migrate to getServiceOrigin() or getPluginBackendUrl() from @naap/plugin-sdk."
    warnings=$((warnings + 1))
  fi
done < <(find plugins/*/frontend/src -name '*.ts' -o -name '*.tsx' 2>/dev/null)

echo ""

# ──────────────────────────────────────────────────────────────
# Check 5: postcss.config.js files that shouldn't exist
# ──────────────────────────────────────────────────────────────
echo "[5/5] Checking for postcss.config.js (should use shared Vite config)..."

while IFS= read -r file; do
  echo -e "  ${YELLOW}WARN${NC}: $file"
  echo "    Plugin has its own postcss.config.js. Remove it — PostCSS is"
  echo "    configured inline in @naap/plugin-build's shared Vite config."
  warnings=$((warnings + 1))
done < <(find plugins/*/frontend -not -path '*/node_modules/*' \( -name 'postcss.config.js' -o -name 'postcss.config.cjs' \) 2>/dev/null)

echo ""

# ──────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────
echo "========================================================"
echo "  Summary"
echo "========================================================"

if [ $errors -gt 0 ]; then
  echo -e "  ${RED}Errors:   $errors${NC} (must fix before deploying)"
fi
if [ $warnings -gt 0 ]; then
  echo -e "  ${YELLOW}Warnings: $warnings${NC} (should fix)"
fi
if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
  echo -e "  ${GREEN}All clean!${NC} No URL pattern issues found."
fi

echo "========================================================"
echo ""

if [ $errors -gt 0 ]; then
  echo -e "${RED}FAIL${NC}: $errors error(s) found. Fix them to avoid Vercel deployment failures."
  exit 1
fi

if [ $warnings -gt 0 ]; then
  echo -e "${YELLOW}PASS with warnings${NC}: $warnings warning(s). Consider fixing for better production safety."
  exit 0
fi

echo -e "${GREEN}PASS${NC}"
exit 0
