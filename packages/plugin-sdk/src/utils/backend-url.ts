/**
 * Backend URL Resolution Utilities
 *
 * IMPORTANT: This file contains DEPRECATED functions.
 * Use the canonical functions from config/ports.ts instead:
 *
 *   import { getServiceOrigin, getPluginBackendUrl } from '@naap/plugin-sdk';
 *
 *   // When you construct full paths (e.g. /api/v1/registry/packages):
 *   const origin = getServiceOrigin('base');
 *   fetch(`${origin}/api/v1/registry/packages`);
 *
 *   // When you use a prefix and append relative paths:
 *   const prefix = getPluginBackendUrl('community', { apiPath: '/api/v1/community' });
 *   fetch(`${prefix}/posts`);
 */

import { getServiceOrigin, getPluginBackendUrl } from '../config/ports.js';

/**
 * @deprecated Use `getServiceOrigin(pluginName)` from `@naap/plugin-sdk` instead.
 *
 * This function had conflicting port mappings with the canonical PLUGIN_PORTS.
 * `getServiceOrigin` uses the single source of truth in config/ports.ts.
 */
export function getBackendUrl(
  pluginName: string,
  _options?: {
    basePort?: number;
    deploymentUrl?: string | null;
  }
): string {
  console.warn(
    `[plugin-sdk] getBackendUrl('${pluginName}') is deprecated. ` +
    `Use getServiceOrigin('${pluginName}') instead.`
  );
  return getServiceOrigin(pluginName);
}

/**
 * @deprecated Use `getPluginBackendUrl(pluginName, { apiPath })` from `@naap/plugin-sdk` instead.
 *
 * This function had conflicting port mappings with the canonical PLUGIN_PORTS.
 */
export function getApiUrl(
  pluginName: string,
  options?: {
    basePort?: number;
    deploymentUrl?: string | null;
    apiPath?: string;
  }
): string {
  console.warn(
    `[plugin-sdk] getApiUrl('${pluginName}') is deprecated. ` +
    `Use getPluginBackendUrl('${pluginName}', { apiPath }) instead.`
  );
  const apiPath = options?.apiPath || `/api/v1/${pluginName}`;
  return getPluginBackendUrl(pluginName, { apiPath });
}

// Re-export active utilities from their canonical location (utils/headers.ts).
// These are NOT deprecated — they live here only for backward-compatible imports.
export { getCsrfToken, generateCorrelationId } from './headers.js';
