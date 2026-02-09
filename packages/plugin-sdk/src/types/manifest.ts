/**
 * Plugin Manifest Schema
 *
 * Re-exports types from @naap/types for backward compatibility.
 * New code should import directly from @naap/types.
 *
 * @deprecated Import from '@naap/types' instead
 */

// Re-export all plugin types from @naap/types
export {
  // Manifest types
  type PluginAuthor,
  type PluginNavigation,
  type PluginFrontend,
  type PluginBackendResources,
  type PluginBackend,
  type PluginDatabase,
  type PluginIntegrations,
  type PluginPermissions,
  type PluginLifecycle,
  type PluginConfigField,
  type PluginConfig,
  type PluginShellCompatibility,
  type PluginDependency,
  type PluginDependencies,
  type PluginRBACPermission,
  type PluginRBACRole,
  type PluginRBAC,
  type PluginManifest,

  // Category and template types
  type PluginCategory,
  type PluginTemplate,

  // Status types
  type PluginStatus,
  type PluginInstallStatus,
  type PluginDeploymentStatus,
  type PluginHealthStatus,

  // Validation types
  type ManifestValidationError,
  type ManifestValidationResult,

  // Runtime types
  type RuntimePluginManifest,
  type DevPlugin,
  type TeamAccessiblePlugin,

  // Constants
  PLUGIN_CATEGORIES,
  RESERVED_PLUGIN_NAMES,
  isReservedPluginName,
} from '@naap/types';

// ============================================
// Production Manifest Types (CDN-deployed plugins)
// ============================================

/**
 * Production manifest for CDN-deployed UMD plugins.
 * This is generated during the build process and stored alongside the bundle.
 */
export interface ProductionManifest {
  /** Plugin name (kebab-case) */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** Semantic version */
  version: string;

  /** CDN URL for the main bundle */
  bundleUrl: string;

  /** CDN URL for styles (optional) */
  stylesUrl?: string;

  /** Global variable name for UMD bundle */
  globalName: string;

  /** Content hash for cache validation */
  bundleHash: string;

  /** Bundle size in bytes */
  bundleSize: number;

  /** Routes this plugin handles */
  routes: string[];

  /** Plugin category */
  category?: string;

  /** Plugin description */
  description?: string;

  /** Plugin icon name */
  icon?: string;

  /** Minimum shell version required */
  minShellVersion?: string;

  /** Maximum shell version supported */
  maxShellVersion?: string;

  /** Required capabilities from the shell */
  requiredCapabilities?: string[];

  /** Build timestamp */
  buildTime: string;

  /** Source commit hash (optional) */
  commitHash?: string;
}

/**
 * UMD Plugin Module interface.
 * This is what a UMD plugin bundle must export via its global name.
 */
export interface UMDPluginModule {
  /** Mount function to render the plugin */
  mount: (
    container: HTMLElement,
    context: import('./services.js').ShellContext
  ) => (() => void) | void;

  /** Optional unmount function */
  unmount?: () => void;

  /** Plugin metadata */
  metadata?: {
    name: string;
    version: string;
  };
}

/**
 * Plugin deployment type enumeration.
 */
export type PluginDeploymentType =
  /** Plugin is deployed to CDN as a UMD bundle */
  | 'cdn'
  /** Plugin runs in a container (has backend) */
  | 'container'
  /** Plugin is embedded in the shell (first-party) */
  | 'embedded';

/**
 * CDN plugin deployment info.
 * Stored in database for CDN-deployed plugins.
 */
export interface CDNPluginDeployment {
  /** Plugin name */
  pluginName: string;

  /** Plugin version */
  version: string;

  /** CDN URL for the bundle */
  bundleUrl: string;

  /** CDN URL for styles (optional) */
  stylesUrl?: string;

  /** Content hash for cache busting */
  bundleHash: string;

  /** Bundle size in bytes */
  bundleSize: number;

  /** Deployment type */
  deploymentType: 'cdn';

  /** Deployment timestamp */
  deployedAt: Date;

  /** Whether this is the active version */
  isActive: boolean;
}
