# Migration: PR 87 Plugin Registry Cleanup

After PR 87 (refactor: move 6 non-essential plugins to examples/), the production database may contain stale plugin records. This migration cleans them up so only the 6 remaining plugins are registered and visible.

## Option A: Automatic (Vercel Deploy)

1. In Vercel Dashboard → Project → Settings → Environment Variables, add:
   - `RUN_PLUGIN_CLEANUP` = `1`
2. Trigger a production deploy (push to main or redeploy).
3. After deploy succeeds, **remove** the `RUN_PLUGIN_CLEANUP` variable.
4. The cleanup runs only when that env var is set.

## Option B: Manual Run

## What Gets Cleaned

- **WorkflowPlugin**: Soft-disables gatewayManager, orchestratorManager, networkAnalytics, myWallet, daydreamVideo, myDashboard
- **PluginPackage**: Unlists those 6 from the marketplace
- **TenantPluginInstall** / **TeamPluginInstall**: Removes installs for the 6 moved plugins
- **UserPluginPreference**: Removes user preferences for the 6 moved plugins
- **PluginPackage.developerApi**: Ensures `isCore: true`

## Manual Run Against Vercel Postgres

1. Get your Vercel Postgres connection string:
   - Vercel Dashboard → Storage → Your Postgres → .env.local tab
   - Or: `vercel env pull` and use `POSTGRES_PRISMA_URL` or `DATABASE_URL`

2. Dry run (no changes):
   ```bash
   POSTGRES_PRISMA_URL="postgresql://..." npx tsx bin/cleanup-moved-plugins.ts --dry-run
   ```

3. Apply changes:
   ```bash
   POSTGRES_PRISMA_URL="postgresql://..." npx tsx bin/cleanup-moved-plugins.ts --force
   ```

## Post-Cleanup

- The next Vercel deploy runs `sync-plugin-registry` which registers/updates the 6 remaining plugins
- User preferences for the 6 core plugins are created on first load via the personalized API (lazy auto-install)
- Or run the seed locally/remotely to populate preferences: `npm run db:seed`
