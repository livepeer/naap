/**
 * Plugin SDK Configuration Exports
 *
 * Provides centralized configuration for port mappings, URLs, and API paths.
 */

export {
  // Port mappings
  PLUGIN_PORTS,
  DEFAULT_PORT,
  type PluginName,

  // Port access
  getPluginPort,
  isKnownPlugin,
  getRegisteredPlugins,

  // Port validation
  validatePort,
  assertCorrectPort,
  type PortValidationResult,

  // URL resolution
  getPluginBackendUrl,
  type PluginBackendUrlOptions,

  // API paths
  API_PATHS,
  getApiPath,
} from './ports.js';
