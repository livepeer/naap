/**
 * Shared Plugin Transformers
 *
 * Utilities for transforming plugin data between different formats.
 * These are used by both frontend and backend to maintain consistency.
 */

import type {
  RuntimePluginManifest,
  DevPlugin,
  TeamAccessiblePlugin,
} from './plugin';

/**
 * Convert a DevPlugin to RuntimePluginManifest format
 * Used for dev mode plugins that need to be loaded alongside production plugins
 */
export function devPluginToManifest(
  devPlugin: DevPlugin,
  order: number = 0
): RuntimePluginManifest {
  return {
    id: `dev-${devPlugin.name}`,
    name: devPlugin.name,
    displayName: `${devPlugin.displayName} (DEV)`,
    version: '0.0.0-dev',
    remoteUrl: devPlugin.devUrl,
    routes: devPlugin.routes,
    enabled: true,
    order: order,
    icon: devPlugin.icon || 'Code',
    pinned: true,
    isDev: true,
    metadata: {
      backendUrl: devPlugin.backendUrl,
      devMode: true,
    },
  };
}

/**
 * Convert a TeamAccessiblePlugin to RuntimePluginManifest format
 * Used when loading plugins in a team context
 */
export function teamPluginToManifest(
  plugin: TeamAccessiblePlugin,
  order: number = 0
): RuntimePluginManifest {
  const pkg = plugin.deployment.package;
  return {
    id: plugin.installId,
    name: pkg.name,
    displayName: pkg.displayName || pkg.name,
    version: pkg.version || '1.0.0',
    remoteUrl: plugin.deployment.frontendUrl,
    routes: pkg.routes || [`/${pkg.name}`],
    enabled: plugin.visible && plugin.canUse,
    order: order,
    icon: pkg.icon || undefined,
    pinned: false,
    metadata: {
      backendUrl: plugin.deployment.backendUrl,
      mergedConfig: plugin.mergedConfig,
      pluginRole: plugin.pluginRole,
      canConfigure: plugin.canConfigure,
    },
  };
}

/**
 * Extract plugin names from a list of manifests
 * Useful for dependency checking and duplicate detection
 */
export function extractPluginNames(plugins: RuntimePluginManifest[]): Set<string> {
  return new Set(plugins.map(p => p.name));
}

/**
 * Check if a plugin has missing dependencies
 */
export function getMissingDependencies(
  plugin: RuntimePluginManifest,
  availablePlugins: Set<string>
): string[] {
  const missing: string[] = [];

  if (plugin.dependencies?.plugins) {
    for (const dep of plugin.dependencies.plugins) {
      if (!dep.optional && !availablePlugins.has(dep.name)) {
        missing.push(dep.name);
      }
    }
  }

  return missing;
}

/**
 * Result of dependency version check
 */
export interface DependencyCheckResult {
  /** Dependencies that are completely missing */
  missing: string[];
  /** Dependencies with version mismatch */
  versionMismatch: Array<{ name: string; required: string; available: string }>;
}

/**
 * Simple semver comparison for basic version constraints
 * Supports: *, ^major.minor.patch, ~major.minor.patch, >=major.minor.patch, exact match
 */
function satisfiesVersion(available: string, required: string): boolean {
  // Wildcard matches everything
  if (required === '*' || required === '') {
    return true;
  }

  // Parse versions into components
  const parseVersion = (v: string): [number, number, number] | null => {
    const cleanVersion = v.replace(/^[^0-9]*/, ''); // Remove prefix like ^ or ~
    const match = cleanVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [
      parseInt(match[1], 10),
      parseInt(match[2] || '0', 10),
      parseInt(match[3] || '0', 10),
    ];
  };

  const availableParts = parseVersion(available);
  const requiredParts = parseVersion(required);

  if (!availableParts || !requiredParts) {
    // Can't parse, assume compatible
    return true;
  }

  const [avMajor, avMinor, avPatch] = availableParts;
  const [reqMajor, reqMinor, reqPatch] = requiredParts;

  // Caret (^) - compatible with major version
  if (required.startsWith('^')) {
    if (reqMajor === 0) {
      // For 0.x.x, only minor must match
      return avMajor === reqMajor && avMinor === reqMinor && avPatch >= reqPatch;
    }
    return avMajor === reqMajor && (avMinor > reqMinor || (avMinor === reqMinor && avPatch >= reqPatch));
  }

  // Tilde (~) - compatible with minor version
  if (required.startsWith('~')) {
    return avMajor === reqMajor && avMinor === reqMinor && avPatch >= reqPatch;
  }

  // Greater than or equal (>=)
  if (required.startsWith('>=')) {
    if (avMajor !== reqMajor) return avMajor > reqMajor;
    if (avMinor !== reqMinor) return avMinor > reqMinor;
    return avPatch >= reqPatch;
  }

  // Greater than (>)
  if (required.startsWith('>') && !required.startsWith('>=')) {
    if (avMajor !== reqMajor) return avMajor > reqMajor;
    if (avMinor !== reqMinor) return avMinor > reqMinor;
    return avPatch > reqPatch;
  }

  // Exact match (or unknown prefix, treat as exact)
  return avMajor === reqMajor && avMinor === reqMinor && avPatch === reqPatch;
}

/**
 * Check plugin dependencies including version constraints
 * Returns missing dependencies and version mismatches
 */
export function checkDependencies(
  plugin: RuntimePluginManifest,
  availablePlugins: Map<string, { version: string }>
): DependencyCheckResult {
  const result: DependencyCheckResult = { missing: [], versionMismatch: [] };

  if (plugin.dependencies?.plugins) {
    for (const dep of plugin.dependencies.plugins) {
      const available = availablePlugins.get(dep.name);

      if (!available) {
        if (!dep.optional) {
          result.missing.push(dep.name);
        }
      } else if (dep.version && dep.version !== '*') {
        if (!satisfiesVersion(available.version, dep.version)) {
          result.versionMismatch.push({
            name: dep.name,
            required: dep.version,
            available: available.version,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Extract plugin names with versions from a list of manifests
 * For use with checkDependencies
 */
export function extractPluginsWithVersions(
  plugins: RuntimePluginManifest[]
): Map<string, { version: string }> {
  return new Map(plugins.map(p => [p.name, { version: p.version }]));
}

/**
 * Find production plugins that would be affected by dev plugin overrides
 * Returns list of plugins that depend on the overridden plugins
 */
export function findAffectedByOverride(
  devPluginNames: Set<string>,
  productionPlugins: RuntimePluginManifest[]
): RuntimePluginManifest[] {
  return productionPlugins.filter(p =>
    p.dependencies?.plugins?.some(dep => devPluginNames.has(dep.name))
  );
}

/**
 * Deep merge two objects (for config merging)
 * Personal config overrides shared config
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base } as T;

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      const baseValue = base[key];
      const overrideValue = override[key];

      if (
        overrideValue !== undefined &&
        overrideValue !== null &&
        typeof baseValue === 'object' &&
        typeof overrideValue === 'object' &&
        !Array.isArray(baseValue) &&
        !Array.isArray(overrideValue)
      ) {
        // Recursively merge objects
        (result as Record<string, unknown>)[key] = deepMerge(
          baseValue as Record<string, unknown>,
          overrideValue as Record<string, unknown>
        );
      } else if (overrideValue !== undefined) {
        // Override primitive values and arrays
        (result as Record<string, unknown>)[key] = overrideValue;
      }
    }
  }

  return result;
}

/**
 * Topologically sort plugins by dependency order
 * Ensures dependencies load before dependents
 */
export function sortPluginsByDependency(
  plugins: RuntimePluginManifest[]
): RuntimePluginManifest[] {
  const pluginMap = new Map(plugins.map(p => [p.name, p]));
  const result: RuntimePluginManifest[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection

  function visit(plugin: RuntimePluginManifest): void {
    if (visited.has(plugin.name)) return;
    if (visiting.has(plugin.name)) {
      // Cycle detected, just add it and continue
      console.warn(`Dependency cycle detected involving plugin: ${plugin.name}`);
      return;
    }

    visiting.add(plugin.name);

    // Visit dependencies first
    if (plugin.dependencies?.plugins) {
      for (const dep of plugin.dependencies.plugins) {
        const depPlugin = pluginMap.get(dep.name);
        if (depPlugin) {
          visit(depPlugin);
        }
      }
    }

    visiting.delete(plugin.name);
    visited.add(plugin.name);
    result.push(plugin);
  }

  // Visit all plugins
  for (const plugin of plugins) {
    visit(plugin);
  }

  return result;
}

/**
 * Create a minimal TeamAccessiblePlugin for testing/mocking
 */
export function createMockTeamPlugin(
  name: string,
  overrides?: Partial<TeamAccessiblePlugin>
): TeamAccessiblePlugin {
  return {
    installId: `mock-install-${name}`,
    visible: true,
    canUse: true,
    canConfigure: false,
    pluginRole: null,
    mergedConfig: {},
    deployment: {
      id: `mock-deployment-${name}`,
      frontendUrl: `http://localhost:3000/cdn/plugins/${name}/1.0.0/${name}.js`,
      backendUrl: null,
      package: {
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        version: '1.0.0',
        icon: null,
        routes: [`/${name}`],
      },
    },
    ...overrides,
  };
}
