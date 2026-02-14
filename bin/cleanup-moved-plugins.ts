#!/usr/bin/env npx tsx
/**
 * cleanup-moved-plugins.ts
 *
 * One-time cleanup script for PR 87: removes/deprecates the 6 plugins moved
 * from plugins/ to examples/. Run against production (Vercel) or any database
 * to align the plugin registry and user preferences with PR 87's changes.
 *
 * Plugins moved to examples/ (removed from registry):
 *   - gateway-manager, orchestrator-manager, network-analytics
 *   - my-wallet, daydream-video, my-dashboard
 *
 * Remaining plugins (6 in plugins/):
 *   - capacity-planner, community, dashboard-provider-mock
 *   - developer-api, marketplace, plugin-publisher
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx bin/cleanup-moved-plugins.ts
 *   # Or with Vercel Postgres:
 *   POSTGRES_PRISMA_URL="..." npx tsx bin/cleanup-moved-plugins.ts
 *
 * Options:
 *   --dry-run   Log actions without committing
 *   --force     Skip confirmation prompt (for CI/automation)
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

async function main(): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    '';

  if (!dbUrl) {
    console.error(
      '[cleanup-moved-plugins] No database URL. Set DATABASE_URL or POSTGRES_PRISMA_URL.',
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  if (!force && !dryRun) {
    console.log('This will clean up 6 moved plugins from the registry and user preferences.');
    console.log('Press Ctrl+C to cancel, or run with --force to skip confirmation.');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    console.log('[cleanup-moved-plugins] Starting cleanup...\n');

    // 1. WorkflowPlugin: soft-disable (camelCase names from plugin-discovery)
    const workflowPlugins = await prisma.workflowPlugin.findMany({
      where: {
        name: {
          in: [
            'gatewayManager',
            'orchestratorManager',
            'networkAnalytics',
            'myWallet',
            'daydreamVideo',
            'myDashboard',
          ],
        },
      },
      select: { name: true, enabled: true },
    });

    for (const p of workflowPlugins) {
      if (p.enabled) {
        console.log(`  [WorkflowPlugin] Disabling ${p.name}`);
        if (!dryRun) {
          await prisma.workflowPlugin.update({
            where: { name: p.name },
            data: { enabled: false },
          });
        }
      }
    }

    // 2. PluginPackage: unlist (find by name, handle both camel and kebab)
    const packages = await prisma.pluginPackage.findMany({
      where: { publishStatus: 'published' },
      select: {
        id: true,
        name: true,
        deployment: { select: { id: true } },
      },
    });

    const toUnlist = packages.filter((p) => {
      const norm = p.name.toLowerCase().replace(/[-_]/g, '');
      return (
        norm === 'gatewaymanager' ||
        norm === 'orchestratormanager' ||
        norm === 'networkanalytics' ||
        norm === 'mywallet' ||
        norm === 'daydreamvideo' ||
        (norm === 'mydashboard' && !p.name.includes('Provider'))
      );
    });

    for (const pkg of toUnlist) {
      console.log(`  [PluginPackage] Unlisting ${pkg.name}`);
      if (!dryRun) {
        await prisma.pluginPackage.update({
          where: { id: pkg.id },
          data: { publishStatus: 'unlisted' },
        });
      }

      // 3 & 4. TenantPluginInstall, TeamPluginInstall: delete for this package's deployment
      const dep = pkg.deployment;
      if (dep) {
        const tenantCount = await prisma.tenantPluginInstall.count({
          where: { deploymentId: dep.id },
        });
        if (tenantCount > 0) {
          console.log(`    [TenantPluginInstall] Deleting ${tenantCount} for ${pkg.name}`);
          if (!dryRun) {
            await prisma.tenantPluginInstall.deleteMany({
              where: { deploymentId: dep.id },
            });
          }
        }

        const teamCount = await prisma.teamPluginInstall.count({
          where: { deploymentId: dep.id },
        });
        if (teamCount > 0) {
          console.log(`    [TeamPluginInstall] Deleting ${teamCount} for ${pkg.name}`);
          if (!dryRun) {
            await prisma.teamPluginInstall.deleteMany({
              where: { deploymentId: dep.id },
            });
          }
        }
      }
    }

    // 5. UserPluginPreference: delete for moved plugins (match any variant)
    const prefs = await prisma.userPluginPreference.findMany({
      select: { id: true, pluginName: true },
    });

    const prefToDelete = prefs.filter((p) => {
      const norm = p.pluginName.toLowerCase().replace(/[-_]/g, '');
      return (
        norm === 'gatewaymanager' ||
        norm === 'orchestratormanager' ||
        norm === 'networkanalytics' ||
        norm === 'mywallet' ||
        norm === 'daydreamvideo' ||
        (norm === 'mydashboard' && !p.pluginName.toLowerCase().includes('provider'))
      );
    });

    for (const pref of prefToDelete) {
        console.log(`  [UserPluginPreference] Deleting preference for ${pref.pluginName}`);
      if (!dryRun) {
        await prisma.userPluginPreference.delete({
          where: { id: pref.id },
        });
      }
    }

    // 6. Ensure developerApi is core (per PR 87's 9d4e65a)
    const devApi = await prisma.pluginPackage.findUnique({
      where: { name: 'developerApi' },
      select: { id: true, isCore: true },
    });
    if (devApi && !devApi.isCore) {
      console.log('  [PluginPackage] Marking developerApi as core');
      if (!dryRun) {
        await prisma.pluginPackage.update({
          where: { name: 'developerApi' },
          data: { isCore: true },
        });
      }
    }

    if (dryRun) {
      console.log('\n[cleanup-moved-plugins] Dry run complete. No changes applied.');
    } else {
      console.log('\n[cleanup-moved-plugins] Cleanup complete.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[cleanup-moved-plugins] Fatal error:', err);
  process.exit(1);
});
