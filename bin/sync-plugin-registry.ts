/**
 * sync-plugin-registry.ts
 *
 * Standalone script that discovers all plugins from plugins/{name}/plugin.json
 * and upserts WorkflowPlugin records in the database.
 *
 * Delegates to the shared discovery utility in packages/database/src/plugin-discovery.ts
 * to avoid duplicating logic with the local seed script (apps/web-next/prisma/seed.ts).
 *
 * Safe to run on every deploy — it is idempotent:
 *   - Creates new plugins that were added to the repo
 *   - Updates existing plugins (CDN URLs, routes, order, etc.)
 *   - Soft-disables plugins that were removed from the repo
 *
 * Execution contexts:
 *   - Local dev: called by bin/start.sh during database sync (every start)
 *   - Vercel build: called by bin/vercel-build.sh step [4/4]
 *   - Manual: `npx tsx bin/sync-plugin-registry.ts`
 *
 * Environment:
 *   DATABASE_URL or POSTGRES_PRISMA_URL must be set.
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import {
  discoverPlugins,
  toWorkflowPluginData,
  toPluginPackageData,
  toPluginVersionData,
  getBundleUrl,
  toKebabCase,
} from '../packages/database/src/plugin-discovery.js';
import { BILLING_PROVIDERS } from '@naap/database';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths — works with both tsx/esm and cjs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONOREPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Synchronize plugin registry with the database.
 * Discovers plugins from plugin.json manifests, upserts WorkflowPlugin and
 * PluginPackage records, and soft-disables plugins no longer in the repo.
 * Cleanup runs in production and local dev; skipped on Vercel preview (shared DB).
 */
async function main(): Promise<void> {
  // Resolve DATABASE_URL — mirror the logic from packages/database/src/index.ts
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    '';

  if (!dbUrl) {
    console.error(
      '[sync-plugin-registry] No database URL found (checked DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL). Skipping registry sync.',
    );
    // Exit 0 so the build does not fail — the registry can be synced later via seed.
    process.exit(0);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  try {
    const discovered = discoverPlugins(MONOREPO_ROOT);
    console.log(
      `[sync-plugin-registry] Discovered ${discovered.length} plugins from plugin.json files`,
    );

    if (discovered.length === 0) {
      console.log('[sync-plugin-registry] Nothing to sync.');
      return;
    }

    // Upsert each discovered plugin using shared utility
    let created = 0;
    let updated = 0;

    for (const p of discovered) {
      const data = toWorkflowPluginData(p, PLUGIN_CDN_URL, MONOREPO_ROOT);

      const existing = await prisma.workflowPlugin.findUnique({
        where: { name: p.name },
        select: { id: true, metadata: true },
      });

      const mergedMetadata = {
        ...((existing?.metadata as Record<string, unknown>) || {}),
        originalRoutes: p.originalRoutes,
      };

      await prisma.workflowPlugin.upsert({
        where: { name: p.name },
        update: { ...data, metadata: mergedMetadata },
        create: { ...data, metadata: mergedMetadata },
      });

      if (existing) {
        updated++;
      } else {
        created++;
      }
    }

    // Cleanup stale plugins — runs in production and local dev.
    // Skipped ONLY on Vercel preview branches, where multiple branches share a
    // single database and branch A disabling branch B's plugins would break previews.
    const discoveredNames = new Set(discovered.map((p) => p.name));
    const isVercelPreview = process.env.VERCEL_ENV === 'preview';
    let disabled = 0;
    let unlisted = 0;

    if (!isVercelPreview) {
      // Collect names of plugins that have active user installations — these
      // were explicitly published and installed via the marketplace or publish
      // endpoints and must NOT be disabled/unlisted during cleanup.
      const activeInstalls = await prisma.tenantPluginInstall.findMany({
        where: { status: 'active' },
        select: { deployment: { select: { package: { select: { name: true } } } } },
      });
      const installedPluginNames = new Set(
        activeInstalls
          .map((i) => i.deployment?.package?.name)
          .filter(Boolean) as string[],
      );

      // Also protect plugins published by a registered publisher
      const publisherOwnedPkgs = await prisma.pluginPackage.findMany({
        where: { publisherId: { not: null } },
        select: { name: true },
      });
      for (const pkg of publisherOwnedPkgs) {
        installedPluginNames.add(pkg.name);
      }

      // Soft-disable stale WorkflowPlugin records (skip actively installed ones)
      const dbPlugins = await prisma.workflowPlugin.findMany({
        where: { enabled: true },
        select: { name: true },
      });

      for (const db of dbPlugins) {
        if (!discoveredNames.has(db.name) && !installedPluginNames.has(db.name)) {
          await prisma.workflowPlugin.update({
            where: { name: db.name },
            data: { enabled: false },
          });
          disabled++;
          console.log(`  [DISABLED] ${db.name} (no longer in repo)`);
        }
      }

      // Unlist stale PluginPackage records (skip actively installed / publisher-owned)
      const publishedPackages = await prisma.pluginPackage.findMany({
        where: { publishStatus: 'published' },
        select: { name: true },
      });

      for (const pkg of publishedPackages) {
        if (!discoveredNames.has(pkg.name) && !installedPluginNames.has(pkg.name)) {
          await prisma.pluginPackage.update({
            where: { name: pkg.name },
            data: { publishStatus: 'unlisted' },
          });
          unlisted++;
          console.log(`  [UNLISTED] ${pkg.name} (no longer in repo)`);
        }
      }
      // Normalize stale top-level routes for non-core, non-discovered plugins.
      // Plugins that were published with legacy top-level routes get moved to /plugins/{name}.
      const coreNames = new Set(
        (await prisma.pluginPackage.findMany({
          where: { isCore: true },
          select: { name: true },
        })).map((p) => p.name),
      );
      const allWPs = await prisma.workflowPlugin.findMany({
        where: { enabled: true },
        select: { name: true, routes: true, metadata: true },
      });
      let normalized = 0;
      for (const wp of allWPs) {
        if (coreNames.has(wp.name) || discoveredNames.has(wp.name)) continue;
        const routes = wp.routes as string[];
        const hasStaleRoutes = routes.some((r) => !r.startsWith('/plugins/'));
        if (hasStaleRoutes) {
          const kebabName = toKebabCase(wp.name);
          const meta = (wp.metadata as Record<string, unknown>) || {};
          await prisma.workflowPlugin.update({
            where: { name: wp.name },
            data: {
              routes: [`/plugins/${kebabName}`, `/plugins/${kebabName}/*`],
              metadata: { ...meta, originalRoutes: meta.originalRoutes || wp.routes },
            },
          });
          normalized++;
          console.log(`  [NORMALIZED] ${wp.name} routes → /plugins/${kebabName}`);
        }
      }
      if (normalized > 0) {
        console.log(`[sync-plugin-registry] Normalized ${normalized} stale route(s)`);
      }
    } else {
      console.log('[sync-plugin-registry] Skipping stale plugin cleanup (Vercel preview — shared DB)');
    }

    console.log(
      `[sync-plugin-registry] WorkflowPlugins: ${created} created, ${updated} updated, ${disabled} disabled`,
    );

    // ------------------------------------------------------------------
    // Sync PluginPackage records (marketplace)
    // ------------------------------------------------------------------
    console.log('[sync-plugin-registry] Syncing marketplace PluginPackage records...');

    let pkgCreated = 0;
    let pkgUpdated = 0;

    for (const p of discovered) {
      const pkgData = toPluginPackageData(p, PLUGIN_CDN_URL);

      const existingPkg = await prisma.pluginPackage.findUnique({
        where: { name: p.name },
        select: { id: true },
      });

      const pkg = await prisma.pluginPackage.upsert({
        where: { name: p.name },
        update: {
          displayName: pkgData.displayName,
          description: pkgData.description,
          category: pkgData.category,
          author: pkgData.author,
          authorEmail: pkgData.authorEmail,
          repository: pkgData.repository,
          license: pkgData.license,
          keywords: pkgData.keywords,
          icon: pkgData.icon,
          isCore: pkgData.isCore,
          publishStatus: 'published',
        },
        create: pkgData,
      });

      if (existingPkg) {
        pkgUpdated++;
      } else {
        pkgCreated++;
      }

      // Ensure a PluginVersion exists
      const versionData = toPluginVersionData(p, pkg.id, PLUGIN_CDN_URL);

      await prisma.pluginVersion.upsert({
        where: {
          packageId_version: {
            packageId: pkg.id,
            version: p.version,
          },
        },
        update: {
          frontendUrl: versionData.frontendUrl,
          manifest: versionData.manifest as any,
        },
        create: versionData,
      });

      // Ensure a PluginDeployment exists
      const version = await prisma.pluginVersion.findUnique({
        where: {
          packageId_version: {
            packageId: pkg.id,
            version: p.version,
          },
        },
        select: { id: true },
      });

      if (version) {
        await prisma.pluginDeployment.upsert({
          where: { packageId: pkg.id },
          update: {
            versionId: version.id,
            status: 'running',
            frontendUrl: getBundleUrl(PLUGIN_CDN_URL, p.dirName, p.version),
            deployedAt: new Date(),
            healthStatus: 'healthy',
          },
          create: {
            packageId: pkg.id,
            versionId: version.id,
            status: 'running',
            frontendUrl: getBundleUrl(PLUGIN_CDN_URL, p.dirName, p.version),
            deployedAt: new Date(),
            healthStatus: 'healthy',
            activeInstalls: 0,
          },
        });
      }
    }

    console.log(
      `[sync-plugin-registry] PluginPackages: ${pkgCreated} created, ${pkgUpdated} updated${!isVercelPreview ? `, ${unlisted} unlisted` : ''}`,
    );

    // ------------------------------------------------------------------
    // Sync BillingProvider catalog (idempotent upsert)
    // ------------------------------------------------------------------
    console.log('[sync-plugin-registry] Syncing billing providers...');

    for (const bp of BILLING_PROVIDERS) {
      await prisma.billingProvider.upsert({
        where: { slug: bp.slug },
        update: {
          displayName: bp.displayName,
          description: bp.description,
          icon: bp.icon,
          authType: bp.authType,
          enabled: bp.enabled,
          sortOrder: bp.sortOrder,
        },
        create: bp,
      });
    }
    console.log(`[sync-plugin-registry] BillingProviders: ${BILLING_PROVIDERS.length} ensured`);

    console.log('[sync-plugin-registry] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sync-plugin-registry] Fatal error:', err);
  // Exit 0 to not fail the Vercel build — registry will be synced on next deploy or via seed
  process.exit(0);
});
