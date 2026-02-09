#!/bin/bash
#
# Vercel Build Pipeline
#
# Full build pipeline for Vercel deployments:
#   1. Build all plugin UMD bundles (auto-discovered)
#   2. Copy bundles to public/cdn/plugins/ for static serving
#   3. Build the Next.js app
#   4. Sync plugin records in the database
#
# Usage: ./bin/vercel-build.sh
#

set -e

# Ensure DATABASE_URL is set (Vercel Storage uses POSTGRES_* prefixes)
export DATABASE_URL="${DATABASE_URL:-$POSTGRES_PRISMA_URL}"

echo "=== Vercel Build Pipeline ==="

# Step 1: Build all plugin UMD bundles
echo "[1/4] Building plugin bundles..."
./bin/build-plugins.sh --parallel

# Step 2: Copy built bundles to public/ for static serving
echo "[2/4] Copying bundles to public/cdn/plugins/..."
mkdir -p apps/web-next/public/cdn/plugins
cp -r dist/plugins/* apps/web-next/public/cdn/plugins/

# Step 3: Build Next.js app
echo "[3/4] Building Next.js app..."
cd apps/web-next
npm run build
cd ../..

# Step 4: Sync plugin registry in database
echo "[4/4] Syncing plugin registry..."
npx tsx bin/sync-plugin-registry.ts

echo "=== Vercel Build Pipeline Complete ==="
