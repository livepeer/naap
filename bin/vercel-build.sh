#!/bin/bash
#
# Vercel Build Pipeline
#
# Full build pipeline for Vercel deployments:
#   1. Build plugin UMD bundles (selective for previews, all for production)
#   2. Copy bundles to public/cdn/plugins/ for static serving
#   3. Push schema to database (skip generate — postinstall already did it)
#   4. Build the Next.js app
#   5. Sync plugin records in the database
#
# Optimizations for preview builds:
#   - Only rebuilds plugins that changed (git diff detection)
#   - Skips prisma db push if schema unchanged
#   - Skips sync-plugin-registry if no plugin.json changed
#   - Source-hash caching via build-plugins.sh avoids redundant builds
#
# Usage: ./bin/vercel-build.sh
#

set -e

# Sanity check: must run from monorepo root
if [ ! -f "package.json" ] || [ ! -d "apps/web-next" ]; then
  echo "ERROR: vercel-build.sh must run from monorepo root (contains package.json and apps/web-next)"
  exit 1
fi

# Ensure DATABASE_URL is set (Vercel Storage uses POSTGRES_* prefixes)
export DATABASE_URL="${DATABASE_URL:-$POSTGRES_PRISMA_URL}"

echo "=== Vercel Build Pipeline ==="
echo "Environment: ${VERCEL_ENV:-unknown}"

# Step 1: Build plugin UMD bundles
# Production: always build all plugins to ensure complete bundles.
# Preview: only build plugins that changed in this commit for faster builds.
# The source-hash cache in build-plugins.sh provides an additional layer —
# even "all" builds will skip unchanged plugins if the cache is warm.
if [ "${VERCEL_ENV}" = "production" ]; then
  echo "[1/5] Building ALL plugin bundles (production)..."
  ./bin/build-plugins.sh --parallel
else
  echo "[1/5] Building plugin bundles (preview — selective)..."
  # Detect which plugins changed compared to the previous commit.
  # VERCEL_GIT_PREVIOUS_SHA is set by Vercel for incremental builds.
  DIFF_BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"
  CHANGED_PLUGINS=$(git diff --name-only "$DIFF_BASE" HEAD -- plugins/ 2>/dev/null | \
    sed -n 's|^plugins/\([^/]*\)/.*|\1|p' | sort -u || true)

  if [ -n "$CHANGED_PLUGINS" ]; then
    echo "  Changed plugins: $CHANGED_PLUGINS"
    for plugin in $CHANGED_PLUGINS; do
      if [ -d "plugins/$plugin/frontend" ]; then
        ./bin/build-plugins.sh --plugin "$plugin" || echo "WARN: Build failed for $plugin (continuing)"
      fi
    done
  else
    echo "  No plugin changes detected"
  fi

  # Build-plugins.sh with --parallel will also use source-hash caching,
  # so run it to ensure all plugins have bundles (cached ones are instant).
  ./bin/build-plugins.sh --parallel
fi

# Step 2: Copy built bundles to public/ for static serving
echo "[2/5] Copying bundles to public/cdn/plugins/..."
mkdir -p apps/web-next/public/cdn/plugins
if [ -d "dist/plugins" ]; then
  cp -r dist/plugins/* apps/web-next/public/cdn/plugins/
fi

# Step 3: Push schema to database
# NOTE: prisma generate is NOT needed here — it already ran during
# npm install via packages/database postinstall hook.
# Only push schema if it changed (or always for production).
DIFF_BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"
# Validate DIFF_BASE; fall back to HEAD~1, then force updates if both fail
if ! git rev-parse --verify "$DIFF_BASE" >/dev/null 2>&1; then
  echo "WARN: DIFF_BASE ($DIFF_BASE) is invalid, falling back to HEAD~1"
  DIFF_BASE="HEAD~1"
  if ! git rev-parse --verify "$DIFF_BASE" >/dev/null 2>&1; then
    echo "WARN: HEAD~1 also invalid (first commit?), forcing schema/registry updates"
    SCHEMA_CHANGED="forced"
  fi
fi
if [ -z "${SCHEMA_CHANGED:-}" ]; then
  SCHEMA_CHANGED=$(git diff --name-only "$DIFF_BASE" HEAD -- packages/database/prisma/ 2>/dev/null | head -1 || true)
fi

if [ -n "$SCHEMA_CHANGED" ] || [ "${VERCEL_ENV}" = "production" ]; then
  echo "[3/5] Prisma db push (schema changed or production)..."
  cd packages/database || { echo "ERROR: Failed to cd to packages/database"; exit 1; }
  npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "WARN: prisma db push had issues (non-fatal)"
  cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }
else
  echo "[3/5] Skipping Prisma db push (schema unchanged in this commit)"
fi

# Step 4: Build Next.js app
echo "[4/5] Building Next.js app..."
cd apps/web-next || { echo "ERROR: Failed to cd to apps/web-next"; exit 1; }
npm run build
cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }

# Step 5: Sync plugin registry in database
# Only sync if plugin.json files changed (or always for production).
if [ "${SCHEMA_CHANGED:-}" = "forced" ]; then
  PLUGINS_CHANGED="forced"
else
  PLUGINS_CHANGED=$(git diff --name-only "$DIFF_BASE" HEAD -- plugins/*/plugin.json 2>/dev/null | head -1 || true)
fi

if [ -n "$PLUGINS_CHANGED" ] || [ "${VERCEL_ENV}" = "production" ]; then
  echo "[5/5] Syncing plugin registry..."
  npx tsx bin/sync-plugin-registry.ts
else
  echo "[5/5] Skipping plugin registry sync (no plugin.json changes)"
fi

echo "=== Vercel Build Pipeline Complete ==="
