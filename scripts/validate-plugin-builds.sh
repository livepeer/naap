#!/bin/bash
#
# Validate NAAP Plugin UMD Builds
#
# This script ensures all plugin bundles:
# 1. Do NOT contain bundled React JSX runtime (prevents version conflicts)
# 2. Externalize all required dependencies
# 3. Have proper UMD wrapper format
#
# Run this in CI before deploying plugins.
#

set -e

PLUGINS_DIR="${1:-./dist/plugins}"
ERRORS=0

echo "🔍 Validating plugin UMD bundles in $PLUGINS_DIR"
echo ""

# Required: bundles should NOT contain bundled React internals
FORBIDDEN_PATTERNS=(
  "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"
  "react-jsx-runtime.production"
  "react-jsx-runtime.development"
)

# Required: bundles MUST externalize these (check for global references)
REQUIRED_EXTERNALS=(
  "React"
  "ReactDOM"
)

for plugin_dir in "$PLUGINS_DIR"/*/; do
  plugin_name=$(basename "$plugin_dir")

  # Find JS bundle in version subdirectory
  for version_dir in "$plugin_dir"*/; do
    js_file=$(find "$version_dir" -maxdepth 1 -name "*.js" ! -name "*.map" 2>/dev/null | head -1)

    if [ -z "$js_file" ]; then
      continue
    fi

    echo "📦 Checking: $plugin_name ($(basename "$version_dir"))"

    # Check for forbidden patterns (bundled React internals)
    for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
      if grep -q "$pattern" "$js_file" 2>/dev/null; then
        echo "  ❌ ERROR: Contains bundled React internals: $pattern"
        echo "     This will cause conflicts with the shell's React version!"
        echo "     Fix: Add 'react/jsx-runtime' to vite.config externals"
        ERRORS=$((ERRORS + 1))
      fi
    done

    # Check UMD wrapper format (should reference window globals)
    if ! head -1 "$js_file" | grep -q "globalThis\|self" 2>/dev/null; then
      echo "  ⚠️  WARNING: May not be a proper UMD bundle"
    fi

    # Check externals are properly referenced
    for external in "${REQUIRED_EXTERNALS[@]}"; do
      # Check the UMD wrapper references the global
      if ! head -1 "$js_file" | grep -q "\.$external" 2>/dev/null; then
        echo "  ⚠️  WARNING: May not externalize $external properly"
      fi
    done

    # Check bundle size (warn if too large - might have bundled dependencies)
    size=$(stat -f%z "$js_file" 2>/dev/null || stat -c%s "$js_file" 2>/dev/null)
    size_kb=$((size / 1024))

    if [ "$size_kb" -gt 500 ]; then
      echo "  ⚠️  WARNING: Large bundle (${size_kb}KB) - verify dependencies are externalized"
    else
      echo "  ✓ Bundle size: ${size_kb}KB"
    fi

    if [ $ERRORS -eq 0 ]; then
      echo "  ✓ No bundled React internals found"
    fi

    echo ""
  done
done

if [ $ERRORS -gt 0 ]; then
  echo "❌ Validation failed with $ERRORS error(s)"
  exit 1
else
  echo "✅ All plugin bundles validated successfully"
  exit 0
fi
