#!/bin/bash
#
# Vercel Build Pipeline
#
# Full build pipeline for Vercel deployments:
#   1. Build plugin UMD bundles (source-hash cache skips unchanged)
#   2. Copy bundles to public/cdn/plugins/ for static serving
#   3. Push schema to database (skip generate — postinstall already did it)
#   4. Build the Next.js app
#   5. Sync plugin records in the database
#
# Optimizations:
#   - Source-hash caching skips unchanged plugins (build-plugins.sh)
#   - prisma db push and sync-plugin-registry always run (idempotent, ~5s + ~2s)
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

# When CI restores a valid plugin cache (content-based key), skip plugin build to avoid stale output.
# SKIP_PLUGIN_BUILD is set by .github/workflows/ci.yml when plugin cache hits.
if [ "${SKIP_PLUGIN_BUILD}" = "true" ] && [ -d "dist/plugins" ] && [ -n "$(ls -A dist/plugins 2>/dev/null)" ]; then
  echo "[0/5] Skipping plugin build (CI cache hit — dist/plugins restored)"
  echo "[1/5] Skipping plugin bundles (using cached dist/plugins)"
else
  # Build plugin-build (and plugin-utils) so plugin vite configs resolve to dist/.js
  # Plugin vite.config.ts imports @naap/plugin-build/vite; Node ESM cannot load .ts directly.
  echo "[0/5] Building plugin-build package..."
  npx tsc -p packages/plugin-build/tsconfig.json || { echo "ERROR: plugin-build build failed"; exit 1; }
  (cd packages/plugin-utils && npm run build --if-present) || true

  # Step 1: Build plugin UMD bundles
  # Production and preview: build all plugins. Source-hash caching in build-plugins.sh
  # skips unchanged plugins, so --parallel is efficient for both.
  echo "[1/5] Building plugin bundles..."
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
# Always push — it's idempotent (no-ops when schema matches) and takes ~5s.
# The previous diff-based skip was unreliable for feature branches where
# schema changes were many commits back (DIFF_BASE only checks recent commits).
echo "[3/5] Prisma db push..."
cd packages/database || { echo "ERROR: Failed to cd to packages/database"; exit 1; }
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "WARN: prisma db push had issues (non-fatal)"
cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }

# Step 4: Build Next.js app
echo "[4/5] Building Next.js app..."
cd apps/web-next || { echo "ERROR: Failed to cd to apps/web-next"; exit 1; }
npm run build
cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }

# Step 5: Sync plugin registry in database
# Always run — it's idempotent (upserts) and fast (~2-3s).
# This ensures stale plugins are cleaned up when plugins are removed,
# and new plugins are registered even if only the sync script changed.
echo "[5/5] Syncing plugin registry..."
npx tsx bin/sync-plugin-registry.ts

echo "=== Vercel Build Pipeline Complete ==="
