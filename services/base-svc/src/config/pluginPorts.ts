/**
 * Plugin Port Configuration - Env-Driven Resolution
 *
 * Provides helpers to derive plugin ports from environment variables
 * with canonical fallback defaults. Used by:
 * - portAllocator (reserved ports)
 * - health-check.sh (via matching contract)
 * - API proxy routing
 *
 * Environment variables take precedence over canonical defaults.
 * Ports are extracted from URLs like "http://localhost:4006" or
 * "https://api.example.com:4006".
 */

/**
 * Mapping from plugin kebab-name to its environment variable key.
 * Must match the contract in:
 * - apps/web-next/src/app/api/v1/[plugin]/[...path]/route.ts
 * - bin/health-check.sh
 */
export const PLUGIN_ENV_MAP: Record<string, string> = {
  'base': 'BASE_SVC_URL',
  'plugin-server': 'PLUGIN_SERVER_URL',
  'capacity-planner': 'CAPACITY_PLANNER_URL',
  'marketplace': 'MARKETPLACE_URL',
  'community': 'COMMUNITY_URL',
  'developer-api': 'DEVELOPER_API_URL',
  'my-wallet': 'WALLET_URL',
  'my-dashboard': 'DASHBOARD_URL',
  'plugin-publisher': 'PLUGIN_PUBLISHER_URL',
  'daydream-video': 'DAYDREAM_VIDEO_URL',
};

/**
 * Canonical fallback ports for each plugin/service.
 * Must match plugins/{name}/plugin.json → backend.devPort
 * and apps/web-next/src/lib/plugin-ports.ts
 */
export const CANONICAL_PORTS: Record<string, number> = {
  'base': 4000,
  'plugin-server': 3100,
  'capacity-planner': 4003,
  'marketplace': 4005,
  'community': 4006,
  'developer-api': 4007,
  'my-wallet': 4008,
  'my-dashboard': 4009,
  'plugin-publisher': 4010,
  'daydream-video': 4111,
};

/** Default port when plugin is not found */
export const DEFAULT_PORT = 4000;

/**
 * Extract port number from a URL string.
 *
 * @param url - URL string like "http://localhost:4006" or "https://api.example.com:4006/path"
 * @returns Port number if present and valid, undefined otherwise
 *
 * @example
 * extractPortFromUrl('http://localhost:4006') // 4006
 * extractPortFromUrl('https://api.example.com:4007/api') // 4007
 * extractPortFromUrl('https://api.example.com/api') // undefined (default port)
 * extractPortFromUrl('invalid') // undefined
 */
export function extractPortFromUrl(url: string): number | undefined {
  if (!url || typeof url !== 'string') {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const port = parseInt(parsed.port, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        return port;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get the resolved port for a plugin, checking env first then falling back to canonical.
 *
 * @param pluginName - Plugin name (kebab-case, e.g., 'my-wallet', 'community')
 * @returns Resolved port number
 *
 * @example
 * // With WALLET_URL=http://localhost:4008
 * getPluginPortFromEnv('my-wallet') // 4008
 *
 * // Without env var set
 * getPluginPortFromEnv('my-wallet') // 4008 (canonical fallback)
 *
 * // With WALLET_URL=https://api.prod.com:9000
 * getPluginPortFromEnv('my-wallet') // 9000 (from env URL)
 */
export function getPluginPortFromEnv(pluginName: string): number {
  const envKey = PLUGIN_ENV_MAP[pluginName];

  if (envKey) {
    const envUrl = process.env[envKey];
    if (envUrl) {
      const envPort = extractPortFromUrl(envUrl);
      if (envPort !== undefined) {
        return envPort;
      }
    }
  }

  return CANONICAL_PORTS[pluginName] ?? DEFAULT_PORT;
}

/**
 * Get the full URL for a plugin backend service.
 *
 * @param pluginName - Plugin name (kebab-case)
 * @returns Full URL string
 */
export function getPluginUrl(pluginName: string): string {
  const envKey = PLUGIN_ENV_MAP[pluginName];

  if (envKey) {
    const envUrl = process.env[envKey];
    if (envUrl) {
      return envUrl;
    }
  }

  const port = CANONICAL_PORTS[pluginName] ?? DEFAULT_PORT;
  return `http://localhost:${port}`;
}

/**
 * Get all reserved ports from environment + canonical defaults.
 * These ports should not be dynamically allocated to other plugins.
 *
 * @returns Array of reserved port numbers (deduplicated)
 *
 * @example
 * // Returns all plugin ports from env URLs or canonical defaults
 * getReservedPortsFromEnv() // [4000, 3100, 4003, 4005, 4006, 4007, 4008, 4009, 4010, 4111]
 */
export function getReservedPortsFromEnv(): number[] {
  const ports = new Set<number>();

  for (const pluginName of Object.keys(CANONICAL_PORTS)) {
    const port = getPluginPortFromEnv(pluginName);
    ports.add(port);
  }

  return Array.from(ports).sort((a, b) => a - b);
}

/**
 * Get all plugin names that have port configurations.
 */
export function getConfiguredPlugins(): string[] {
  return Object.keys(CANONICAL_PORTS);
}
