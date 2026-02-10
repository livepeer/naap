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

/** Convert kebab-case to camelCase: "my-wallet" -> "myWallet" */
export function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convert camelCase to PascalCase: "myWallet" -> "MyWallet" */
export function toPascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── CDN URL Helpers ─────────────────────────────────────────────────────────

/**
 * Build the CDN bundle URL for a plugin.
 * @param cdnBase - CDN base path (e.g. "/cdn/plugins")
 * @param dirName - Plugin directory name in kebab-case (e.g. "my-wallet")
 * @param version - Semver version string (e.g. "1.0.0")
 */
export function getBundleUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.js`;
}

/**
 * Build the CDN stylesheet URL for a plugin.
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
}

/**
 * Scan the `plugins/` directory and read each `plugin.json` manifest.
 * Returns an array of discovered plugins sorted by navigation order.
 *
 * @param rootDir - Monorepo root directory (must contain a `plugins/` folder)
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

/**
 * Build the WorkflowPlugin upsert data for a discovered plugin.
 * This is the shape expected by `prisma.workflowPlugin.upsert()`.
 */
export function toWorkflowPluginData(
  plugin: DiscoveredPlugin,
  cdnBase: string = '/cdn/plugins',
) {
  // Only set stylesUrl if the plugin's build output actually contains a CSS file.
  // Headless plugins (like dashboard-provider-mock) produce no CSS, and a 404
  // stylesheet URL causes MIME-type errors in the browser.
  let stylesUrl: string | undefined;
  try {
    const manifestPath = path.join(
      'dist', 'plugins', plugin.dirName, plugin.version, 'manifest.json',
    );
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.stylesFile) {
        stylesUrl = getStylesUrl(cdnBase, plugin.dirName, plugin.version);
      }
    } else {
      // Fallback: assume CSS exists (safe — non-blocking load handles 404 gracefully)
      stylesUrl = getStylesUrl(cdnBase, plugin.dirName, plugin.version);
    }
  } catch {
    // On any error, default to setting the URL (non-blocking load is safe)
    stylesUrl = getStylesUrl(cdnBase, plugin.dirName, plugin.version);
  }

  return {
    name: plugin.name,
    displayName: plugin.displayName,
    version: plugin.version,
    remoteUrl: getBundleUrl(cdnBase, plugin.dirName, plugin.version),
    bundleUrl: getBundleUrl(cdnBase, plugin.dirName, plugin.version),
    stylesUrl,
    globalName: plugin.globalName,
    deploymentType: 'cdn',
    routes: plugin.routes,
    enabled: true,
    order: plugin.order,
    icon: plugin.icon,
  };
}
