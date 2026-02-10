/**
 * Unified Plugin Types
 *
 * Single source of truth for all plugin-related type definitions.
 * These types are shared across:
 * - @naap/plugin-sdk
 * - services/base-svc (backend)
 * - apps/web-next (frontend shell)
 */

/** Recursively makes all properties optional (useful for validation inputs) */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object | undefined
    ? DeepPartial<NonNullable<T[P]>>
    : T[P];
};

// ============================================
// Plugin Manifest Types
// ============================================

/**
 * Plugin author information
 */
export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Navigation configuration for plugin sidebar entry
 */
export interface PluginNavigation {
  /** Path for navigation link */
  path: string;
  /** Display label in sidebar */
  label: string;
  /** Lucide icon name */
  icon?: string;
  /** Sort order in sidebar (lower = higher) */
  order?: number;
  /** Group name for grouping plugins */
  group?: string;
}

/**
 * Frontend configuration for plugin
 */
export interface PluginFrontend {
  /** Path to the built UMD bundle file */
  entry: string;
  /** Port for development server */
  devPort?: number;
  /** Routes this plugin handles (e.g., ["/wallet", "/wallet/*"]) */
  routes: string[];
  /** Navigation configuration for sidebar */
  navigation?: PluginNavigation;
}

/**
 * Resource limits for plugin backend
 */
export interface PluginBackendResources {
  /** Memory limit (e.g., "512Mi", "1Gi") */
  memory?: string;
  /** CPU limit (e.g., "500m", "1") */
  cpu?: string;
}

/**
 * Backend configuration for plugin
 */
export interface PluginBackend {
  /** Path to the built server entry file */
  entry: string;
  /** Port for development server */
  devPort?: number;
  /** Production port */
  port: number;
  /** Health check endpoint (default: /health) */
  healthCheck?: string;
  /** API prefix for routes (e.g., /api/v1/wallet) */
  apiPrefix: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Resource limits */
  resources?: PluginBackendResources;
  /** Docker image reference (for containerized deployments) */
  image?: string;
}

/**
 * Database configuration for plugin
 */
export interface PluginDatabase {
  /** Database type */
  type: 'postgresql' | 'mysql' | 'mongodb';
  /** Whether database is required */
  required?: boolean;
  /** Path to Prisma schema */
  schema?: string;
  /** Path to migrations directory */
  migrations?: string;
  /** Path to seed script */
  seed?: string;
}

/**
 * External integrations configuration
 */
export interface PluginIntegrations {
  /** Required integrations (plugin won't work without these) */
  required: string[];
  /** Optional integrations (enhanced features) */
  optional: string[];
}

/**
 * Permission scopes for plugin
 */
export interface PluginPermissions {
  /** Shell permissions (navigation, notifications, theme) */
  shell?: string[];
  /** Other plugin APIs this plugin can access */
  apis?: string[];
  /** External URLs this plugin can access */
  external?: string[];
}

/**
 * Lifecycle script hooks
 */
export interface PluginLifecycle {
  /** Script to run after installation */
  postInstall?: string;
  /** Script to run before update */
  preUpdate?: string;
  /** Script to run after update */
  postUpdate?: string;
  /** Script to run before uninstall */
  preUninstall?: string;
}

/**
 * Configuration field schema for plugin settings
 */
export interface PluginConfigField {
  /** Field type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Human-readable description */
  description?: string;
  /** Default value */
  default?: unknown;
  /** Whether field is required */
  required?: boolean;
  /** Whether field contains sensitive data (will be encrypted) */
  secret?: boolean;
  /** Allowed values for enum fields */
  enum?: unknown[];
  /** Minimum value for numbers / minimum length for strings */
  min?: number;
  /** Maximum value for numbers / maximum length for strings */
  max?: number;
}

/**
 * Plugin configuration schema
 */
export interface PluginConfig {
  /** Schema defining configurable fields */
  schema: Record<string, PluginConfigField>;
}

/**
 * Shell version compatibility
 */
export interface PluginShellCompatibility {
  /** Minimum shell version (semver) */
  minVersion?: string;
  /** Maximum shell version (semver) */
  maxVersion?: string;
}

/**
 * Plugin isolation mode for security sandboxing
 * Phase 0: Added as part of security foundation
 * 
 * - 'none': Default. Plugin runs in same context as shell (trusted plugins only)
 * - 'iframe': Plugin runs in sandboxed iframe with postMessage communication
 * - 'worker': Plugin runs in Web Worker (future, maximum isolation)
 */
export type PluginIsolationMode = 'none' | 'iframe' | 'worker';

/**
 * Plugin dependency definition
 */
export interface PluginDependency {
  /** Plugin name that this plugin depends on */
  name: string;
  /** Required version (semver range, e.g., "^1.0.0") */
  version: string;
  /** If true, plugin can load without this dependency */
  optional?: boolean;
}

/**
 * Plugin dependencies configuration
 */
export interface PluginDependencies {
  /** Other plugins this plugin depends on */
  plugins?: PluginDependency[];
  /** Minimum shell version required */
  shell?: string;
}

/**
 * RBAC permission definition
 */
export interface PluginRBACPermission {
  /** Resource name */
  resource: string;
  /** Action type */
  action: 'create' | 'read' | 'update' | 'delete' | 'admin' | '*';
}

/**
 * Plugin-specific role definition
 */
export interface PluginRBACRole {
  /** Role name (will be prefixed with plugin name) */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Role description */
  description?: string;
  /** Permissions granted to this role */
  permissions: PluginRBACPermission[];
  /** Parent roles to inherit permissions from */
  inherits?: string[];
}

/**
 * Plugin RBAC configuration
 */
export interface PluginRBAC {
  /** Custom roles defined by this plugin */
  roles?: PluginRBACRole[];
}

/**
 * Complete plugin manifest (plugin.json)
 */
export interface PluginManifest {
  /** JSON Schema reference */
  $schema?: string;

  /** Unique plugin identifier (kebab-case, 3-50 chars) */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /** Plugin version (semver) */
  version: string;

  /** Plugin description */
  description?: string;

  /** Plugin author */
  author?: PluginAuthor;

  /** Repository URL */
  repository?: string;

  /** License (SPDX identifier) */
  license?: string;

  /** Keywords for marketplace search */
  keywords?: string[];

  /** Category for marketplace */
  category?: PluginCategory;

  /** Shell compatibility */
  shell?: PluginShellCompatibility;

  /** Plugin dependencies */
  dependencies?: PluginDependencies;

  /** Frontend configuration */
  frontend?: PluginFrontend;

  /** Backend configuration */
  backend?: PluginBackend;

  /** Database configuration */
  database?: PluginDatabase;

  /** External integrations */
  integrations?: PluginIntegrations;

  /** Required permissions */
  permissions?: PluginPermissions;

  /** Lifecycle scripts */
  lifecycle?: PluginLifecycle;

  /** Plugin configuration schema */
  config?: PluginConfig;

  /** RBAC role definitions */
  rbac?: PluginRBAC;

  /**
   * Plugin isolation mode for security sandboxing
   * Default: 'none' (backward compatible - runs in same context)
   * Use 'iframe' for untrusted plugins from marketplace
   * @default 'none'
   */
  isolation?: PluginIsolationMode;
}

// ============================================
// Runtime Plugin (API / DB shape)
// ============================================

/**
 * Runtime representation of a plugin as returned by the API / WorkflowPlugin DB row.
 * This is distinct from the design-time `PluginManifest` (plugin.json shape).
 * Use this for frontend contexts, plugin loading, and API responses.
 */
export interface RuntimePlugin {
  name: string;
  displayName: string;
  version: string;
  routes: string[];
  enabled: boolean;
  order: number;
  icon?: string;
  metadata?: Record<string, unknown>;
  // CDN/UMD deployment fields
  bundleUrl?: string;
  stylesUrl?: string;
  bundleHash?: string;
  bundleSize?: number;
  globalName?: string;
  // Additional metadata for plugin info
  author?: string;
  publisher?: string;
  latestVersion?: string;
  installedAt?: string;
  createdAt?: string;
  category?: string;
  description?: string;
  // Legacy field - kept for backward compatibility with API responses
  remoteUrl?: string;
  deploymentType?: string;
  // Whether this plugin is admin-designated as core (cannot be uninstalled)
  isCore?: boolean;
  // Whether this plugin has been explicitly installed by the user
  installed?: boolean;
}

// ============================================
// Plugin Categories
// ============================================

/**
 * Valid plugin categories for marketplace
 */
export type PluginCategory =
  | 'analytics'
  | 'communication'
  | 'developer-tools'
  | 'finance'
  | 'infrastructure'
  | 'integration'
  | 'monitoring'
  | 'networking'
  | 'security'
  | 'storage'
  | 'other';

/**
 * List of all valid plugin categories
 */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  'analytics',
  'communication',
  'developer-tools',
  'finance',
  'infrastructure',
  'integration',
  'monitoring',
  'networking',
  'security',
  'storage',
  'other',
];

// ============================================
// Plugin Template Types
// ============================================

/**
 * Plugin template types for scaffolding
 */
export type PluginTemplate = 'full-stack' | 'frontend-only' | 'backend-only';

// ============================================
// Plugin Status Types
// ============================================

/**
 * Plugin installation status
 */
export type PluginInstallStatus =
  | 'pending'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'uninstalling'
  | 'rolledback'
  | 'upgrading';

/**
 * Plugin deployment status
 */
export type PluginDeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

/**
 * Plugin health status
 */
export type PluginHealthStatus =
  | 'healthy'
  | 'unhealthy'
  | 'unknown'
  | 'degraded';

/**
 * Complete plugin status information
 */
export interface PluginStatus {
  /** Whether plugin is installed */
  installed: boolean;
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Currently installed version */
  version: string;
  /** Available update version (if any) */
  updateAvailable?: string;
  /** Whether plugin is deprecated */
  deprecated?: boolean;
  /** Deprecation message */
  deprecationMessage?: string;
  /** Installation status */
  installStatus?: PluginInstallStatus;
  /** Deployment status */
  deploymentStatus?: PluginDeploymentStatus;
  /** Health status */
  healthStatus?: PluginHealthStatus;
}

// ============================================
// Validation Types
// ============================================

/**
 * Manifest validation error
 */
export interface ManifestValidationError {
  /** Field path (e.g., "frontend.routes") */
  field: string;
  /** Error message */
  message: string;
  /** Error severity */
  severity: 'error' | 'warning';
}

/**
 * Manifest validation result
 */
export interface ManifestValidationResult {
  /** Whether manifest is valid (no errors) */
  valid: boolean;
  /** Validation errors */
  errors: ManifestValidationError[];
  /** Validation warnings (non-blocking) */
  warnings: ManifestValidationError[];
}

// ============================================
// Runtime Plugin Types (Frontend)
// ============================================

/**
 * Navigation section for plugins in the shell sidebar
 */
export type PluginNavSection = 'main' | 'network' | 'system' | 'hidden';

/**
 * Navigation configuration for runtime plugins
 */
export interface RuntimePluginNavigation {
  /** Which sidebar section this plugin belongs to */
  section: PluginNavSection;
  /** Sort order within the section (lower = higher) */
  order?: number;
  /** Group name for sub-grouping within section */
  group?: string;
}

/**
 * Runtime plugin manifest used by frontend
 * Simplified version of PluginManifest for runtime use
 */
export interface RuntimePluginManifest {
  /** Unique identifier */
  id: string;
  /** Plugin name */
  name: string;
  /** Display name */
  displayName: string;
  /** Version */
  version: string;
  /** URL to plugin bundle (legacy field, kept for backward compat) */
  remoteUrl: string;
  /** Routes handled by this plugin */
  routes: string[];
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Sort order (deprecated, use navigation.order instead) */
  order: number;
  /** Icon name */
  icon?: string;
  /** Whether pinned in sidebar */
  pinned?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Whether this is a dev mode plugin */
  isDev?: boolean;
  /** Plugin dependencies */
  dependencies?: PluginDependencies;
  /** Missing dependencies (computed at runtime) */
  missingDependencies?: string[];
  /** Navigation configuration for sidebar placement */
  navigation?: RuntimePluginNavigation;
  /** Plugin category for marketplace (deprecated for nav, use navigation.section) */
  category?: PluginCategory;
  /**
   * Plugin isolation mode for security sandboxing
   * Default: 'none' (backward compatible - runs in same context)
   * @default 'none'
   */
  isolation?: PluginIsolationMode;
}

/**
 * Dev plugin configuration (for local development)
 */
export interface DevPlugin {
  /** Plugin name */
  name: string;
  /** Display name */
  displayName: string;
  /** Local dev URL to plugin */
  devUrl: string;
  /** Local backend URL (optional) */
  backendUrl?: string;
  /** Routes handled */
  routes: string[];
  /** Icon name */
  icon?: string;
}

// ============================================
// Team Plugin Types
// ============================================

/**
 * Team plugin access response from API
 */
export interface TeamAccessiblePlugin {
  /** Installation ID */
  installId: string;
  /** Whether visible in sidebar */
  visible: boolean;
  /** Whether user can use the plugin */
  canUse: boolean;
  /** Whether user can configure personal settings */
  canConfigure: boolean;
  /** Plugin-specific role */
  pluginRole: string | null;
  /** Merged configuration (shared + personal) */
  mergedConfig: Record<string, unknown>;
  /** Deployment information */
  deployment: {
    id: string;
    frontendUrl: string;
    backendUrl: string | null;
    package: {
      name: string;
      displayName: string;
      version: string;
      icon: string | null;
      routes?: string[];
    };
  };
}

// ============================================
// Reserved Names
// ============================================

/**
 * Reserved plugin names that cannot be used
 */
export const RESERVED_PLUGIN_NAMES = [
  'shell',
  'core',
  'system',
  'admin',
  'api',
  'auth',
  'base',
  'naap',
  'plugin',
  'test',
] as const;

/**
 * Check if a plugin name is reserved
 */
export function isReservedPluginName(name: string): boolean {
  return RESERVED_PLUGIN_NAMES.includes(name as typeof RESERVED_PLUGIN_NAMES[number]);
}
