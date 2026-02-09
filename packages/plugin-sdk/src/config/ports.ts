/**
 * Plugin Port Configuration - Single Source of Truth
 *
 * This file defines the canonical port mappings for all plugins.
 * Both backends and frontends should import from here.
 *
 * Usage in backend:
 *   import { getPluginPort, validatePort } from '@naap/plugin-sdk/config';
 *   const PORT = process.env.PORT || getPluginPort('my-plugin');
 *
 * Usage in frontend:
 *   import { getPluginBackendUrl } from '@naap/plugin-sdk/config';
 *   const url = getPluginBackendUrl('my-plugin');
 */

// ─────────────────────────────────────────────────────────────────────────────
// Port Definitions - THE SINGLE SOURCE OF TRUTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical port mappings for all NAAP plugins and services.
 *
 * Port ranges:
 * - 4000-4099: Core services and plugins
 * - 4100-4199: Extended plugins (daydream-video, etc.)
 */
export const PLUGIN_PORTS = {
  // Core services
  'base': 4000,
  'plugin-server': 4050,

  // Core plugins
  'gateway-manager': 4001,
  'orchestrator-manager': 4002,
  'capacity-planner': 4003,
  'network-analytics': 4004,
  'marketplace': 4005,
  'community': 4006,
  'developer-api': 4007,
  'my-wallet': 4008,
  'my-dashboard': 4009,
  'livepeer': 4010,
  'developer-api-svc': 4011,
  'plugin-publisher': 4012,

  // Extended plugins (4100+)
  'daydream-video': 4111,
} as const;

/** Plugin name type for type safety */
export type PluginName = keyof typeof PLUGIN_PORTS;

/** Default port when plugin is not found */
export const DEFAULT_PORT = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// Port Access Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the port for a specific plugin.
 *
 * @param pluginName - The plugin name (e.g., 'my-wallet', 'plugin-publisher')
 * @returns The port number for the plugin
 *
 * @example
 * ```typescript
 * const port = getPluginPort('plugin-publisher'); // Returns 4012
 * ```
 */
export function getPluginPort(pluginName: string): number {
  const port = PLUGIN_PORTS[pluginName as PluginName];
  if (!port) {
    console.warn(`[plugin-sdk] Unknown plugin "${pluginName}", using default port ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }
  return port;
}

/**
 * Check if a plugin name is known/registered.
 */
export function isKnownPlugin(pluginName: string): pluginName is PluginName {
  return pluginName in PLUGIN_PORTS;
}

/**
 * Get all registered plugin names.
 */
export function getRegisteredPlugins(): PluginName[] {
  return Object.keys(PLUGIN_PORTS) as PluginName[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Port Validation (for backend startup)
// ─────────────────────────────────────────────────────────────────────────────

export interface PortValidationResult {
  valid: boolean;
  expectedPort: number;
  actualPort: number;
  message: string;
}

/**
 * Validate that a backend is starting on the correct port.
 * Call this at backend startup to catch port misconfigurations early.
 *
 * @param pluginName - The plugin name
 * @param actualPort - The port the backend is actually starting on
 * @returns Validation result with details
 *
 * @example
 * ```typescript
 * const PORT = process.env.PORT || 4010;
 * const validation = validatePort('plugin-publisher', Number(PORT));
 * if (!validation.valid) {
 *   console.warn(validation.message);
 * }
 * ```
 */
export function validatePort(pluginName: string, actualPort: number): PortValidationResult {
  const expectedPort = getPluginPort(pluginName);

  if (actualPort === expectedPort) {
    return {
      valid: true,
      expectedPort,
      actualPort,
      message: `Port ${actualPort} is correct for "${pluginName}"`,
    };
  }

  // If using process.env.PORT, it might be intentionally different (e.g., in production)
  const isEnvOverride = process.env.PORT !== undefined;

  return {
    valid: isEnvOverride, // Allow override via env
    expectedPort,
    actualPort,
    message: isEnvOverride
      ? `Port ${actualPort} for "${pluginName}" differs from default ${expectedPort} (overridden by PORT env)`
      : `WARNING: "${pluginName}" should run on port ${expectedPort}, but is configured for ${actualPort}. ` +
        `Update PLUGIN_PORTS in @naap/plugin-sdk/config if this is intentional.`,
  };
}

/**
 * Assert that a backend is on the correct port (throws on mismatch).
 * Use in development to catch misconfigurations early.
 */
export function assertCorrectPort(pluginName: string, actualPort: number): void {
  const validation = validatePort(pluginName, actualPort);
  if (!validation.valid) {
    throw new Error(validation.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Resolution (for frontend use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether we are running in a production/deployed environment
 * (i.e. NOT on localhost).
 */
function isProductionHost(): boolean {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  }
  // SSR / Node – check for VERCEL env
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

/**
 * Get the *origin* (scheme + host + port) of a plugin service.
 *
 * This is the correct function when the caller supplies a **full path**
 * that already starts with `/api/v1/…`.
 *
 * | Environment | Returns                                     |
 * |-------------|---------------------------------------------|
 * | Dev         | `http://localhost:{port}` (e.g. `:4000`)    |
 * | Production  | `''` (empty string → same-origin)           |
 *
 * ### When to use this vs `getPluginBackendUrl`
 *
 * ```ts
 * // ✅ USE getServiceOrigin  –  you already have a full API path
 * const origin = getServiceOrigin('base');       // '' in prod, 'http://localhost:4000' in dev
 * fetch(`${origin}/api/v1/registry/packages`);   // works in both environments
 *
 * // ✅ USE getPluginBackendUrl  –  you want an API *prefix* and will append a relative path
 * const prefix = getPluginBackendUrl('community', { apiPath: '/api/v1/community' });
 * fetch(`${prefix}/posts`);                      // /api/v1/community/posts in prod
 *
 * // ❌ NEVER do this  –  creates /api/v1/base/api/v1/registry/packages on Vercel
 * const bad = getPluginBackendUrl('base');
 * fetch(`${bad}/api/v1/registry/packages`);
 * ```
 *
 * @param pluginName - Plugin or service name (used to look up the dev port)
 * @param overridePort - Optional port override for development
 */
export function getServiceOrigin(pluginName: string = 'base', overridePort?: number): string {
  // 1. Shell context override (iframe mode)
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shellContext = (window as any).__SHELL_CONTEXT__ as
      | { config?: Record<string, unknown> }
      | undefined;
    if (shellContext?.config) {
      const camelCaseName = pluginName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const configKey = `${camelCaseName}ApiUrl`;
      const configUrl = shellContext.config[configKey];
      if (configUrl && typeof configUrl === 'string') {
        // Strip any trailing path — we only want the origin
        try {
          const u = new URL(configUrl);
          return u.origin;
        } catch {
          return configUrl;
        }
      }
    }
  }

  // 2. Environment variable overrides
  const envKey = pluginName.toUpperCase().replace(/-/g, '_');
  if (typeof process !== 'undefined' && process.env) {
    const nodeUrl = process.env[`${envKey}_BACKEND_URL`] || process.env[`NEXT_PUBLIC_${envKey}_API_URL`];
    if (nodeUrl) {
      try { return new URL(nodeUrl).origin; } catch { return nodeUrl; }
    }
  }

  // 3. Production / Vercel — same-origin
  if (isProductionHost()) {
    return '';
  }

  // 4. Development — localhost + port
  const resolvedPort = overridePort || getPluginPort(pluginName);
  return typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${resolvedPort}`
    : `http://localhost:${resolvedPort}`;
}

export interface PluginBackendUrlOptions {
  /** Custom port override for development */
  port?: number;
  /** API path prefix (e.g., '/api/v1/my-plugin') */
  apiPath?: string;
}

/**
 * Get the backend URL for a specific plugin.
 *
 * Resolution order:
 * 1. window.__SHELL_CONTEXT__.config[pluginName + 'ApiUrl']
 * 2. Environment variable: VITE_{PLUGIN_NAME}_API_URL
 * 3. Development convention: http://localhost:{port}
 *
 * @param pluginName - The plugin name (e.g., 'my-wallet', 'daydream-video')
 * @param options - Optional configuration
 * @returns The resolved backend URL
 */
export function getPluginBackendUrl(pluginName: string, options?: PluginBackendUrlOptions): string {
  const { port, apiPath = '' } = options || {};

  // 1. Check shell context config first
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shellContext = (window as any).__SHELL_CONTEXT__ as
      | { config?: Record<string, unknown> }
      | undefined;
    if (shellContext?.config) {
      // Try pluginNameApiUrl format (e.g., 'myWalletApiUrl')
      const camelCaseName = pluginName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const configKey = `${camelCaseName}ApiUrl`;
      const configUrl = shellContext.config[configKey];
      if (configUrl && typeof configUrl === 'string') {
        return `${configUrl}${apiPath}`;
      }
    }
  }

  // 2. Check environment variables (browser)
  const envKey = pluginName.toUpperCase().replace(/-/g, '_');

  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (window as any).env as Record<string, string> | undefined;
    if (env) {
      const viteUrl = env[`VITE_${envKey}_API_URL`];
      if (viteUrl) return `${viteUrl}${apiPath}`;

      const craUrl = env[`REACT_APP_${envKey}_API_URL`];
      if (craUrl) return `${craUrl}${apiPath}`;
    }
  }

  // 3. Check process.env (Node.js)
  if (typeof process !== 'undefined' && process.env) {
    const nodeUrl = process.env[`${envKey}_BACKEND_URL`] || process.env[`NEXT_PUBLIC_${envKey}_API_URL`];
    if (nodeUrl) return `${nodeUrl}${apiPath}`;
  }

  // 4. Production / deployed environments: use same-origin (no port).
  //    On Vercel (or any non-localhost deployment) plugin backends don't
  //    run as separate services — all API traffic goes through the
  //    Next.js API proxy on the same origin.
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // Same-origin: just the API path, no host/port needed.
      return apiPath || `/api/v1/${pluginName}`;
    }
  }

  // 5. Development convention: localhost with known port
  const resolvedPort = port || getPluginPort(pluginName);
  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:${resolvedPort}`
      : `http://localhost:${resolvedPort}`;

  return `${baseUrl}${apiPath}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Path Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known API path prefixes for plugins.
 * This helps avoid double-prefix issues like /api/api/v1/...
 */
export const API_PATHS = {
  // Services accessed via shell API client (which adds /api prefix automatically)
  'livepeer': '/v1/livepeer',
  'base': '/v1/base',

  // Services accessed directly
  'plugin-publisher': '/api/v1/plugin-publisher',
  'my-wallet': '/api/v1/wallet',
  'community': '/api/v1/community',
  'daydream-video': '/api/v1/daydream-video',
} as const;

/**
 * Get the API path for a plugin.
 * Use this when making API calls to avoid double-prefix issues.
 *
 * @param pluginName - The plugin name
 * @param viaShellApi - Whether the call goes through shell.api (which adds /api prefix)
 * @returns The API path to use
 */
export function getApiPath(pluginName: string, viaShellApi: boolean = false): string {
  const knownPath = API_PATHS[pluginName as keyof typeof API_PATHS];

  if (knownPath) {
    return knownPath;
  }

  // Default pattern
  if (viaShellApi) {
    // Shell API adds /api prefix, so just use /v1/pluginName
    return `/v1/${pluginName}`;
  } else {
    // Direct calls need the full path
    return `/api/v1/${pluginName}`;
  }
}
