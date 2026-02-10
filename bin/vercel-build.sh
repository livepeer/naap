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
echo "[1/5] Building plugin bundles..."
./bin/build-plugins.sh --parallel

# Step 2: Copy built bundles to public/ for static serving
echo "[2/5] Copying bundles to public/cdn/plugins/..."
mkdir -p apps/web-next/public/cdn/plugins
cp -r dist/plugins/* apps/web-next/public/cdn/plugins/

# Step 3: Generate Prisma client & push schema to Neon
echo "[3/5] Prisma generate & db push..."
cd packages/database
npx prisma generate
npx prisma db push --accept-data-loss 2>&1 || echo "WARN: prisma db push had issues (non-fatal)"
cd ../..

# Step 4: Build Next.js app
echo "[4/5] Building Next.js app..."
cd apps/web-next
npm run build
cd ../..

# Step 5: Sync plugin registry in database
echo "[5/5] Syncing plugin registry..."
npx tsx bin/sync-plugin-registry.ts

echo "=== Vercel Build Pipeline Complete ==="
