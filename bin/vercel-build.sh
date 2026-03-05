#!/bin/bash
#
# Vercel Build Pipeline
#
# Full build pipeline for Vercel deployments:
#   1. Build plugin UMD bundles (source-hash cache skips unchanged)
#   2. Copy bundles to public/cdn/plugins/ for static serving
#   3. Push schema to database (skip generate — postinstall already did it)
#   4. Sync plugin records + generate plugin-routes.json (before Next.js build)
#   5. Build the Next.js app
#   6. Optional one-time cleanup
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
  echo "[0/6] Skipping plugin build (CI cache hit — dist/plugins restored)"
  echo "[1/6] Skipping plugin bundles (using cached dist/plugins)"
else
  # Build plugin-build (and plugin-utils) so plugin vite configs resolve to dist/.js
  # Plugin vite.config.ts imports @naap/plugin-build/vite; Node ESM cannot load .ts directly.
  echo "[0/6] Building plugin-build package..."
  npx tsc -p packages/plugin-build/tsconfig.json || { echo "ERROR: plugin-build build failed"; exit 1; }
  (cd packages/plugin-utils && npm run build --if-present) || true

  # Step 1: Build plugin UMD bundles
  # Production and preview: build all plugins. Source-hash caching in build-plugins.sh
  # skips unchanged plugins, so --parallel is efficient for both.
  echo "[1/6] Building plugin bundles..."
  ./bin/build-plugins.sh --parallel
fi

# Step 2: Copy built bundles to public/ for static serving
echo "[2/6] Copying bundles to public/cdn/plugins/..."
mkdir -p apps/web-next/public/cdn/plugins
if [ -d "dist/plugins" ]; then
  cp -r dist/plugins/* apps/web-next/public/cdn/plugins/
fi

# Step 3: Push schema to database
# NOTE: prisma generate is NOT needed here — it already ran during
# npm install via packages/database postinstall hook.
#
# Runs for both production and preview environments:
#   - Production: pushes to the Neon "main" branch (via production-scoped DATABASE_URL)
#   - Preview: pushes to the Neon "preview" branch (via preview-scoped DATABASE_URL)
# Each Vercel environment has its own DATABASE_URL pointing to the correct
# Neon branch, so there is no risk of preview schema changes affecting production.
# The preview branch is automatically reset after each production deploy.
if [ "${VERCEL_ENV}" = "production" ] || [ "${VERCEL_ENV}" = "preview" ]; then
  echo "[3/6] Prisma db push (${VERCEL_ENV})..."
  cd packages/database || { echo "ERROR: Failed to cd to packages/database"; exit 1; }
  npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "WARN: prisma db push had issues (non-fatal)"
  cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }
else
  echo "[3/6] Skipping prisma db push (VERCEL_ENV=${VERCEL_ENV:-unset}, only runs on production/preview)"
fi

# Step 4: Sync plugin registry in database (BEFORE build so generated files
# like plugin-routes.json are available to the Next.js middleware bundler).
# Always run — it's idempotent (upserts) and fast (~2-3s).
echo "[4/6] Syncing plugin registry..."
npx tsx bin/sync-plugin-registry.ts

# Step 5: Build Next.js app
echo "[5/6] Building Next.js app..."
cd apps/web-next || { echo "ERROR: Failed to cd to apps/web-next"; exit 1; }
npm run build
cd ../.. || { echo "ERROR: Failed to cd back to root"; exit 1; }

# Step 6: (Optional) One-time cleanup for PR 87 moved plugins
# Set RUN_PLUGIN_CLEANUP=1 in Vercel env to run once, then remove.
if [ "${RUN_PLUGIN_CLEANUP}" = "1" ] && [ "${VERCEL_ENV}" = "production" ] && [ -n "$DATABASE_URL" ]; then
  echo "[6/6] Running plugin cleanup (PR 87)..."
  npx tsx bin/cleanup-moved-plugins.ts --force 2>&1 || echo "WARN: cleanup had issues (non-fatal)"
fi

echo "=== Vercel Build Pipeline Complete ==="
