/**
 * Plugin Auto-Registration
 *
 * Scans plugins/\*\/plugin.json at server startup and ensures all discovered
 * plugins have the necessary database records:
 *   - WorkflowPlugin (sidebar navigation & CDN loading)
 *   - PluginPackage   (marketplace listing)
 *   - PluginVersion   (version tracking)
 *   - PluginDeployment (deployment status)
 *   - Role            (RBAC admin role per plugin)
 *
 * This eliminates the need to manually re-run the seed script whenever a new
 * plugin is added to the monorepo. The seed remains useful for creating test
 * users, teams, and feature flags, but plugin registration is fully automatic.
 *
 * Runs in: instrumentation.ts → register() hook (Node.js runtime only).
 * Safety:  All operations are idempotent upserts. Failures are non-fatal.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Minimal Plugin Discovery (inline, no external deps) ─────────────────

function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCase(s: string): string {
  const camel = toCamelCase(s);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

interface DiscoveredPlugin {
  dirName: string;
  name: string;       // camelCase
  displayName: string;
  version: string;
  description: string;
  category: string;
  isCore: boolean;
  routes: string[];
  icon: string;
  order: number;
  globalName: string;
  bundleUrl: string;
  stylesUrl: string | null;
  author: string;
  authorEmail: string;
  keywords: string[];
  license: string;
  repository: string;
  rbacRoles?: Array<{ name: string; displayName: string; permissions?: string[] }>;
}

function discoverPlugins(rootDir: string, cdnBase: string): DiscoveredPlugin[] {
  const scanDirs = [
    path.join(rootDir, 'plugins'),
    path.join(rootDir, 'examples'),
  ];

  const results: DiscoveredPlugin[] = [];

  for (const baseDir of scanDirs) {
    if (!fs.existsSync(baseDir)) continue;

    const plugins = fs
      .readdirSync(baseDir)
      .filter((dir) => !dir.startsWith('__') && !dir.startsWith('.'))
      .filter((dir) => fs.existsSync(path.join(baseDir, dir, 'plugin.json')))
      .map((dir) => {
        const raw = fs.readFileSync(path.join(baseDir, dir, 'plugin.json'), 'utf8');
        const manifest = JSON.parse(raw);
        const camelName = toCamelCase(dir);
        const version = '1.0.0';
        const bundleUrl = `${cdnBase}/${dir}/${version}/${dir}.js`;

        // Check for built styles
        let stylesUrl: string | null = null;
        try {
          const cdnManifest = path.join(rootDir, 'dist', 'plugins', dir, version, 'manifest.json');
          const srcManifest = path.join(baseDir, dir, 'frontend', 'dist', 'production', 'manifest.json');
          const mPath = fs.existsSync(cdnManifest) ? cdnManifest
            : fs.existsSync(srcManifest) ? srcManifest : null;
          if (mPath) {
            const buildManifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
            if (buildManifest.stylesFile) {
              stylesUrl = `${cdnBase}/${dir}/${version}/${dir}.css`;
            }
          }
        } catch { /* leave null */ }

        const rawAuthor = manifest.author;
        return {
          dirName: dir,
          name: camelName,
          displayName: manifest.displayName || dir,
          version,
          description: manifest.description || `${manifest.displayName || dir} plugin for NAAP`,
          category: manifest.category || 'other',
          isCore: manifest.isCore === true,
          routes: manifest.frontend?.routes || [],
          icon: manifest.frontend?.navigation?.icon || manifest.icon || 'Box',
          order: manifest.frontend?.navigation?.order ?? 99,
          globalName: `NaapPlugin${toPascalCase(camelName)}`,
          bundleUrl,
          stylesUrl,
          author: typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name || 'NAAP Team',
          authorEmail: typeof rawAuthor === 'object' ? rawAuthor?.email || 'team@naap.io' : 'team@naap.io',
          keywords: manifest.keywords || [],
          license: manifest.license || 'MIT',
          repository: manifest.repository || `https://github.com/livepeer/naap/tree/main/${path.basename(baseDir)}/${dir}`,
          rbacRoles: manifest.rbac?.roles,
        };
      });

    results.push(...plugins);
  }

  return results.sort((a, b) => a.order - b.order);
}

// ─── Database Registration ────────────────────────────────────────────────

/**
 * Auto-discover and register all plugins in the database.
 *
 * Call from instrumentation.ts register() hook. Non-blocking:
 * - Logs a warning and exits silently on failure (e.g. DB not ready).
 * - All operations are idempotent (upserts).
 */
export async function autoRegisterPlugins(): Promise<void> {
  const cdnBase = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

  // Resolve monorepo root. process.cwd() in Next.js is the app dir (apps/web-next).
  const rootDir = path.resolve(process.cwd(), '../..');
  const pluginsDir = path.join(rootDir, 'plugins');
  const examplesDir = path.join(rootDir, 'examples');

  if (!fs.existsSync(pluginsDir) && !fs.existsSync(examplesDir)) {
    // On Vercel or environments without the plugins directory, skip silently.
    // The build-time sync script (bin/sync-plugin-registry.ts) handles Vercel.
    return;
  }

  const discovered = discoverPlugins(rootDir, cdnBase);
  if (discovered.length === 0) return;

  // Lazy-import Prisma to avoid loading it when not needed
  const { PrismaClient } = await import('@naap/database');
  const prisma = new PrismaClient();

  try {
    // Quick check: if plugin count matches exactly, skip (fast path for restarts)
    const dbCount = await prisma.workflowPlugin.count({ where: { enabled: true } });
    const discoveredWithRoutes = discovered.filter((p) => p.routes.length > 0);

    // Only skip if counts match exactly AND all discovered plugins exist.
    // If dbCount > discovered, stale plugins need cleanup — don't skip.
    if (dbCount === discoveredWithRoutes.length) {
      const names = discoveredWithRoutes.map((p) => p.name);
      const existing = await prisma.workflowPlugin.findMany({
        where: { name: { in: names } },
        select: { name: true },
      });
      const existingNames = new Set(existing.map((e) => e.name));
      const missing = names.filter((n) => !existingNames.has(n));
      if (missing.length === 0) {
        console.log(`[naap] All ${discoveredWithRoutes.length} plugins already registered — skipping sync`);
        return;
      }
      console.log(`[naap] Found ${missing.length} unregistered plugins: ${missing.join(', ')}`);
    } else if (dbCount > discoveredWithRoutes.length) {
      console.log(`[naap] DB has ${dbCount} enabled plugins but only ${discoveredWithRoutes.length} discovered — will clean up stale records`);
    }

    console.log(`[naap] Auto-registering ${discovered.length} discovered plugins...`);

    for (const plugin of discovered) {
      // 1. WorkflowPlugin — drives sidebar nav and CDN loading
      await prisma.workflowPlugin.upsert({
        where: { name: plugin.name },
        update: {
          displayName: plugin.displayName,
          version: plugin.version,
          remoteUrl: plugin.bundleUrl,
          bundleUrl: plugin.bundleUrl,
          stylesUrl: plugin.stylesUrl ?? null,
          globalName: plugin.globalName,
          deploymentType: 'cdn',
          routes: plugin.routes,
          enabled: true,
          order: plugin.order,
          icon: plugin.icon,
        },
        create: {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          remoteUrl: plugin.bundleUrl,
          bundleUrl: plugin.bundleUrl,
          stylesUrl: plugin.stylesUrl ?? null,
          globalName: plugin.globalName,
          deploymentType: 'cdn',
          routes: plugin.routes,
          enabled: true,
          order: plugin.order,
          icon: plugin.icon,
        },
      });

      // 2. PluginPackage — marketplace listing
      const pkg = await prisma.pluginPackage.upsert({
        where: { name: plugin.name },
        update: {
          displayName: plugin.displayName,
          description: plugin.description,
          category: plugin.category,
          author: plugin.author,
          authorEmail: plugin.authorEmail,
          repository: plugin.repository,
          license: plugin.license,
          keywords: plugin.keywords,
          icon: plugin.icon,
          isCore: plugin.isCore,
          publishStatus: 'published',
        },
        create: {
          name: plugin.name,
          displayName: plugin.displayName,
          description: plugin.description,
          category: plugin.category,
          author: plugin.author,
          authorEmail: plugin.authorEmail,
          repository: plugin.repository,
          license: plugin.license,
          keywords: plugin.keywords,
          icon: plugin.icon,
          isCore: plugin.isCore,
          publishStatus: 'published',
        },
      });

      // 3. PluginVersion — version tracking
      const ver = await prisma.pluginVersion.upsert({
        where: {
          packageId_version: { packageId: pkg.id, version: plugin.version },
        },
        update: {
          frontendUrl: plugin.bundleUrl,
          manifest: {
            name: plugin.name,
            displayName: plugin.displayName,
            version: plugin.version,
            description: plugin.description,
            category: plugin.category,
            icon: plugin.icon,
          },
        },
        create: {
          packageId: pkg.id,
          version: plugin.version,
          frontendUrl: plugin.bundleUrl,
          manifest: {
            name: plugin.name,
            displayName: plugin.displayName,
            version: plugin.version,
            description: plugin.description,
            category: plugin.category,
            icon: plugin.icon,
          },
        },
      });

      // 4. PluginDeployment — deployment status for install tracking
      await prisma.pluginDeployment.upsert({
        where: { packageId: pkg.id },
        update: {
          versionId: ver.id,
          status: 'running',
          frontendUrl: plugin.bundleUrl,
          deployedAt: new Date(),
          healthStatus: 'healthy',
        },
        create: {
          packageId: pkg.id,
          versionId: ver.id,
          status: 'running',
          frontendUrl: plugin.bundleUrl,
          deployedAt: new Date(),
          healthStatus: 'healthy',
          activeInstalls: 0,
        },
      });

      // 5. RBAC admin role — one per plugin with routes (skip headless)
      if (plugin.routes.length > 0) {
        const roleName = `${plugin.dirName}:admin`;
        await prisma.role.upsert({
          where: { name: roleName },
          update: {},
          create: {
            name: roleName,
            displayName: `${plugin.displayName} Administrator`,
            description: `Full access to ${plugin.dirName} plugin`,
            permissions: [{ resource: `${plugin.dirName}:*`, action: '*' }],
            canAssign: [`${plugin.dirName}:*`],
            inherits: [],
            scope: 'plugin',
            pluginName: plugin.dirName,
          },
        });
      }
    }

    // Cleanup truly orphaned plugins — only disable plugins that are:
    //   1. NOT discovered on the filesystem (not in plugins/ or examples/)
    //   2. NOT installed by any user (no UserPluginPreference records)
    //   3. NOT installed by any tenant (no active TenantPluginInstall records)
    //
    // This ensures externally-published or marketplace-installed plugins
    // are NEVER disrupted by filesystem-based discovery. A plugin that was
    // published and installed remains available regardless of its source location.
    const discoveredNames = new Set(discovered.map((p) => p.name));
    const isPreview = process.env.VERCEL_ENV === 'preview';

    if (!isPreview) {
      const enabledPlugins = await prisma.workflowPlugin.findMany({
        where: { enabled: true },
        select: { name: true },
      });

      for (const db of enabledPlugins) {
        if (discoveredNames.has(db.name)) continue;

        // Check if any user has installed this plugin
        const userInstallCount = await prisma.userPluginPreference.count({
          where: { pluginName: db.name, enabled: true },
        });
        if (userInstallCount > 0) {
          console.log(`[naap]   Keeping ${db.name} (${userInstallCount} user installs)`);
          continue;
        }

        // Check if any tenant deployment exists
        const pkg = await prisma.pluginPackage.findUnique({
          where: { name: db.name },
          select: { deployment: { select: { activeInstalls: true } } },
        });
        if (pkg?.deployment && pkg.deployment.activeInstalls > 0) {
          console.log(`[naap]   Keeping ${db.name} (${pkg.deployment.activeInstalls} tenant installs)`);
          continue;
        }

        // Truly orphaned — no filesystem source, no installs
        await prisma.workflowPlugin.update({
          where: { name: db.name },
          data: { enabled: false },
        });
        console.log(`[naap]   Disabled orphaned plugin: ${db.name}`);
      }

      // Only unlist packages with zero installs AND not on filesystem
      const publishedPackages = await prisma.pluginPackage.findMany({
        where: { publishStatus: 'published' },
        select: {
          name: true,
          deployment: { select: { activeInstalls: true } },
        },
      });
      for (const pkg of publishedPackages) {
        if (discoveredNames.has(pkg.name)) continue;
        if (pkg.deployment && pkg.deployment.activeInstalls > 0) continue;

        const userInstalls = await prisma.userPluginPreference.count({
          where: { pluginName: pkg.name, enabled: true },
        });
        if (userInstalls > 0) continue;

        await prisma.pluginPackage.update({
          where: { name: pkg.name },
          data: { publishStatus: 'unlisted' },
        });
        console.log(`[naap]   Unlisted orphaned package: ${pkg.name}`);
      }
    }

    console.log(`[naap] ✅ Auto-registered ${discovered.length} plugins`);
  } catch (err: unknown) {
    // Non-fatal: DB might not be ready yet (e.g. Docker still starting).
    // The seed script or next health check will eventually catch up.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[naap] Plugin auto-registration skipped (non-fatal): ${message}`);
  } finally {
    await prisma.$disconnect();
  }
}
