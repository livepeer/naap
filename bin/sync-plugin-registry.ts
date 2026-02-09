/**
 * sync-plugin-registry.ts
 *
 * Standalone script that discovers all plugins from plugins/{name}/plugin.json
 * and upserts WorkflowPlugin records in the database.
 *
 * Safe to run on every deploy — it is idempotent:
 *   - Creates new plugins that were added to the repo
 *   - Updates existing plugins (CDN URLs, routes, order, etc.)
 *   - Soft-disables plugins that were removed from the repo
 *
 * Usage:
 *   npx tsx bin/sync-plugin-registry.ts
 *
 * Environment:
 *   DATABASE_URL or POSTGRES_PRISMA_URL must be set.
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths — works with both tsx/esm and cjs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONOREPO_ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(MONOREPO_ROOT, 'plugins');
const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case to camelCase: "my-wallet" -> "myWallet" */
function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convert camelCase to PascalCase: "myWallet" -> "MyWallet" */
function toPascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getBundleUrl(dirName: string, version: string): string {
  return `${PLUGIN_CDN_URL}/${dirName}/${version}/${dirName}.js`;
}

function getStylesUrl(dirName: string, version: string): string {
  return `${PLUGIN_CDN_URL}/${dirName}/${version}/${dirName}.css`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface DiscoveredPlugin {
  dirName: string;
  name: string;
  displayName: string;
  version: string;
  routes: string[];
  icon: string;
  order: number;
  globalName: string;
}

function discoverPlugins(): DiscoveredPlugin[] {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.warn(`  [WARN] plugins directory not found at ${PLUGINS_DIR}`);
    return [];
  }

  return fs
    .readdirSync(PLUGINS_DIR)
    .filter((dir) => fs.existsSync(path.join(PLUGINS_DIR, dir, 'plugin.json')))
    .map((dir) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(PLUGINS_DIR, dir, 'plugin.json'), 'utf8'),
      );
      const camelName = toCamelCase(dir);
      return {
        dirName: dir,
        name: camelName,
        displayName: manifest.displayName || dir,
        version: '1.0.0',
        routes: manifest.frontend?.routes || [],
        icon: manifest.frontend?.navigation?.icon || 'Box',
        order: manifest.frontend?.navigation?.order ?? 99,
        globalName: `NaapPlugin${toPascalCase(camelName)}`,
      };
    })
    .sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
    const discovered = discoverPlugins();
    console.log(
      `[sync-plugin-registry] Discovered ${discovered.length} plugins from plugin.json files`,
    );

    if (discovered.length === 0) {
      console.log('[sync-plugin-registry] Nothing to sync.');
      return;
    }

    // Upsert each discovered plugin
    let created = 0;
    let updated = 0;

    for (const p of discovered) {
      const data = {
        name: p.name,
        displayName: p.displayName,
        version: p.version,
        remoteUrl: getBundleUrl(p.dirName, p.version),
        bundleUrl: getBundleUrl(p.dirName, p.version),
        stylesUrl: getStylesUrl(p.dirName, p.version),
        globalName: p.globalName,
        deploymentType: 'cdn',
        routes: p.routes,
        enabled: true,
        order: p.order,
        icon: p.icon,
      };

      const existing = await prisma.workflowPlugin.findUnique({
        where: { name: p.name },
        select: { id: true },
      });

      await prisma.workflowPlugin.upsert({
        where: { name: p.name },
        update: data,
        create: data,
      });

      if (existing) {
        updated++;
      } else {
        created++;
      }
    }

    // Soft-disable stale plugins that are no longer in the repo
    const discoveredNames = new Set(discovered.map((p) => p.name));
    const dbPlugins = await prisma.workflowPlugin.findMany({
      where: { enabled: true },
      select: { name: true },
    });

    let disabled = 0;
    for (const db of dbPlugins) {
      if (!discoveredNames.has(db.name)) {
        await prisma.workflowPlugin.update({
          where: { name: db.name },
          data: { enabled: false },
        });
        disabled++;
        console.log(`  [DISABLED] ${db.name} (no longer in repo)`);
      }
    }

    console.log(
      `[sync-plugin-registry] Done: ${created} created, ${updated} updated, ${disabled} disabled`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sync-plugin-registry] Fatal error:', err);
  // Exit 0 to not fail the Vercel build — registry will be synced on next deploy or via seed
  process.exit(0);
});
