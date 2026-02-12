// Plugin Discovery Utilities
//
// Shared logic for discovering plugins from plugins/{name}/plugin.json manifests.
// Used by both the local seed script (prisma/seed.ts) and the Vercel build
// registry sync (bin/sync-plugin-registry.ts).
//
// IMPORTANT: This file is Node.js-only (uses fs/path). It must NOT be
// imported in browser/frontend code.

import * as fs from 'fs';
import * as path from 'path';

// ─── String Utilities ────────────────────────────────────────────────────────

/**
 * Convert kebab-case to camelCase.
 * @param s - Input string in kebab-case (e.g. "my-wallet")
 * @returns CamelCase string (e.g. "myWallet")
 */
export function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convert camelCase to PascalCase.
 * @param s - Input string in camelCase (e.g. "myWallet")
 * @returns PascalCase string (e.g. "MyWallet")
 */
export function toPascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── CDN URL Helpers ─────────────────────────────────────────────────────────

/**
 * Build the CDN bundle URL for a plugin.
 * @param cdnBase - CDN base path (e.g. "/cdn/plugins")
 * @param dirName - Plugin directory name in kebab-case (e.g. "my-wallet")
 * @param version - Semver version string (e.g. "1.0.0")
 * @returns Full URL path to the plugin JS bundle
 */
export function getBundleUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.js`;
}

/**
 * Build the CDN stylesheet URL for a plugin.
 * @param cdnBase - CDN base path
 * @param dirName - Plugin directory name in kebab-case
 * @param version - Semver version string
 * @returns Full URL path to the plugin CSS stylesheet
 */
export function getStylesUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.css`;
}

// ─── Plugin Discovery ────────────────────────────────────────────────────────

export interface DiscoveredPlugin {
  /** Directory name in kebab-case (e.g. "my-wallet") */
  dirName: string;
  /** camelCase name for DB records (e.g. "myWallet") */
  name: string;
  /** Human-readable display name from plugin.json */
  displayName: string;
  /** Semver version (always "1.0.0" for local builds) */
  version: string;
  /** Frontend route paths from plugin.json */
  routes: string[];
  /** Navigation icon name */
  icon: string;
  /** Navigation order */
  order: number;
  /** UMD global name (e.g. "NaapPluginMyWallet") */
  globalName: string;

  // ── Marketplace metadata (optional, from plugin.json) ──

  /** Plugin description for marketplace listings */
  description?: string;
  /** Author name */
  author?: string;
  /** Author email */
  authorEmail?: string;
  /** Plugin category (e.g. "analytics", "monitoring", "developer") */
  category?: string;
  /** Search keywords */
  keywords?: string[];
  /** License identifier (e.g. "MIT") */
  license?: string;
  /** Source repository URL */
  repository?: string;
}

/**
 * Scan the `plugins/` directory and read each `plugin.json` manifest.
 *
 * @param rootDir - Monorepo root directory (must contain a `plugins/` folder)
 * @returns Array of discovered plugins sorted by navigation order; empty if plugins dir not found
 */
export function discoverPlugins(rootDir: string): DiscoveredPlugin[] {
  const pluginsDir = path.join(rootDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    console.warn(`[plugin-discovery] plugins directory not found at ${pluginsDir}`);
    return [];
  }

  return fs
    .readdirSync(pluginsDir)
    .filter((dir) => fs.existsSync(path.join(pluginsDir, dir, 'plugin.json')))
    .map((dir) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(pluginsDir, dir, 'plugin.json'), 'utf8'),
      );
      const camelName = toCamelCase(dir);

      // Extract author — supports both string and { name, email } forms
      const rawAuthor = manifest.author;
      const authorName = typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name;
      const authorEmail = typeof rawAuthor === 'object' ? rawAuthor?.email : undefined;

      return {
        dirName: dir,
        name: camelName,
        displayName: manifest.displayName || dir,
        version: '1.0.0',
        routes: manifest.frontend?.routes || [],
        icon: manifest.frontend?.navigation?.icon || 'Box',
        order: manifest.frontend?.navigation?.order ?? 99,
        globalName: `NaapPlugin${toPascalCase(camelName)}`,
        // Marketplace metadata
        description: manifest.description,
        author: authorName,
        authorEmail,
        category: manifest.category,
        keywords: manifest.keywords,
        license: manifest.license,
        repository: manifest.repository,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Build the WorkflowPlugin upsert data for a discovered plugin.
 * This is the shape expected by `prisma.workflowPlugin.upsert()`.
 *
 * @param plugin - Discovered plugin metadata
 * @param cdnBase - CDN base path (e.g. "/cdn/plugins")
 * @param rootDir - Monorepo root directory (for resolving build manifests)
 * @returns Prisma upsert-compatible object for WorkflowPlugin
 */
export function toWorkflowPluginData(
  plugin: DiscoveredPlugin,
  cdnBase: string = '/cdn/plugins',
  rootDir?: string,
) {
  // Only set stylesUrl if the plugin's build output actually contains a CSS file.
  // Headless plugins (like dashboard-provider-mock) produce no CSS, and a 404
  // stylesheet URL causes MIME-type errors in the browser.
  let stylesUrl: string | undefined;
  const root = rootDir || process.cwd();
  try {
    // Check CDN dist manifest first, then fall back to source build output
    const cdnManifest = path.join(
      root, 'dist', 'plugins', plugin.dirName, plugin.version, 'manifest.json',
    );
    const srcManifest = path.join(
      root, 'plugins', plugin.dirName, 'frontend', 'dist', 'production', 'manifest.json',
    );
    const manifestPath = fs.existsSync(cdnManifest) ? cdnManifest
      : fs.existsSync(srcManifest) ? srcManifest
      : null;

    if (manifestPath) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.stylesFile) {
        stylesUrl = getStylesUrl(cdnBase, plugin.dirName, plugin.version);
      }
      // No stylesFile in manifest → stylesUrl stays undefined (correct for headless plugins)
    }
    // If no manifest found at all (plugin not yet built), leave stylesUrl undefined.
    // This is safer than assuming CSS exists, which causes MIME-type errors on 404.
  } catch (err) {
    // On error, leave stylesUrl undefined to avoid broken stylesheet references.
    if (process.env.DEBUG) {
      console.debug(`[plugin-discovery] Failed to resolve manifest for ${plugin.dirName}:`, err);
    }
  }

  return {
    name: plugin.name,
    displayName: plugin.displayName,
    version: plugin.version,
    remoteUrl: getBundleUrl(cdnBase, plugin.dirName, plugin.version),
    bundleUrl: getBundleUrl(cdnBase, plugin.dirName, plugin.version),
    // Use null (not undefined) so Prisma upsert clears stale values
    stylesUrl: stylesUrl ?? null,
    globalName: plugin.globalName,
    deploymentType: 'cdn',
    routes: plugin.routes,
    enabled: true,
    order: plugin.order,
    icon: plugin.icon,
  };
}

// ─── Marketplace (PluginPackage) Data ──────────────────────────────────────────

/**
 * Build the PluginPackage upsert data for a discovered plugin.
 * Only plugins that have at least a `description` in their plugin.json
 * will produce meaningful marketplace entries.
 *
 * @param plugin - Discovered plugin metadata
 * @param cdnBase - CDN base path
 * @returns Prisma upsert-compatible object for PluginPackage
 */
export function toPluginPackageData(
  plugin: DiscoveredPlugin,
  cdnBase: string = '/cdn/plugins',
) {
  return {
    name: plugin.name,
    displayName: plugin.displayName,
    description: plugin.description || `${plugin.displayName} plugin for NAAP`,
    category: plugin.category || 'other',
    author: plugin.author || 'NAAP Team',
    authorEmail: plugin.authorEmail || 'team@naap.io',
    repository: plugin.repository || `https://github.com/livepeer/naap/tree/main/plugins/${plugin.dirName}`,
    license: plugin.license || 'MIT',
    keywords: plugin.keywords || [],
    icon: plugin.icon,
    isCore: false,
    publishStatus: 'published',
  };
}

/**
 * Build the PluginVersion data for the initial version of a marketplace entry.
 *
 * @param plugin - Discovered plugin metadata
 * @param packageId - UUID of the PluginPackage record
 * @param cdnBase - CDN base path
 * @returns Prisma create-compatible object for PluginVersion
 */
export function toPluginVersionData(
  plugin: DiscoveredPlugin,
  packageId: string,
  cdnBase: string = '/cdn/plugins',
) {
  return {
    packageId,
    version: plugin.version,
    frontendUrl: getBundleUrl(cdnBase, plugin.dirName, plugin.version),
    manifest: {
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      description: plugin.description || '',
      category: plugin.category || 'other',
      icon: plugin.icon,
    },
  };
}
