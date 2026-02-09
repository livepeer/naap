/**
 * Plugin Feature Flags
 *
 * Controls plugin loading behavior. All plugins use UMD/CDN loading.
 */

/**
 * Feature flag configuration
 */
export interface PluginFeatureFlags {
  /** Enable IndexedDB caching for plugin bundles */
  enableBundleCaching: boolean;

  /** Enable plugin sandbox for security restrictions */
  enableSandbox: boolean;

  /** Enable strict CSP headers for plugins */
  enableStrictCSP: boolean;

  /** Enable Vercel Blob storage for plugin assets */
  enableBlobStorage: boolean;

  /** Enable detailed plugin loading metrics */
  enableMetrics: boolean;

  /** Maximum retry attempts for CDN loading */
  maxRetryAttempts: number;

  /** Timeout for CDN bundle loading (ms) */
  loadTimeout: number;
}

/**
 * Default feature flags (conservative defaults for production)
 */
const DEFAULT_FLAGS: PluginFeatureFlags = {
  enableBundleCaching: true,
  enableSandbox: true,
  enableStrictCSP: true,
  enableBlobStorage: false, // Off by default until Blob is configured
  enableMetrics: true,
  maxRetryAttempts: 3,
  loadTimeout: 30000,
};

/**
 * Development environment flags (more permissive)
 */
const DEV_FLAGS: Partial<PluginFeatureFlags> = {
  enableBlobStorage: true,
  enableStrictCSP: false, // Allow HMR
  loadTimeout: 60000, // Longer timeout for development
};

/**
 * Staging environment flags (testing new features)
 */
const STAGING_FLAGS: Partial<PluginFeatureFlags> = {
  enableBlobStorage: true,
  enableStrictCSP: true,
};

/**
 * Current feature flags (memoized)
 */
let currentFlags: PluginFeatureFlags | null = null;

/**
 * Gets the current environment
 * Note: In Next.js, NODE_ENV is inlined at build time, so this works on both server and client
 */
function getEnvironment(): 'development' | 'staging' | 'production' {
  // Check NEXT_PUBLIC_ env vars first (works on client)
  if (typeof window !== 'undefined') {
    // Check if running on localhost (development)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'development';
    }
    // Check if it's a Vercel preview deployment
    if (window.location.hostname.includes('vercel.app') && !window.location.hostname.includes('prod')) {
      return 'staging';
    }
  }

  // Server-side check
  if (typeof process !== 'undefined') {
    if (process.env.NODE_ENV === 'development') return 'development';
    if (process.env.VERCEL_ENV === 'preview') return 'staging';
  }
  return 'production';
}

/**
 * Loads feature flags from environment and remote config
 */
export function getPluginFeatureFlags(): PluginFeatureFlags {
  if (currentFlags) {
    return currentFlags;
  }

  const env = getEnvironment();
  let envFlags: Partial<PluginFeatureFlags> = {};

  switch (env) {
    case 'development':
      envFlags = DEV_FLAGS;
      break;
    case 'staging':
      envFlags = STAGING_FLAGS;
      break;
    default:
      envFlags = {};
  }

  // Merge with environment variable overrides
  const overrides: Partial<PluginFeatureFlags> = {};

  if (typeof process !== 'undefined') {
    if (process.env.ENABLE_BLOB_STORAGE === 'true') {
      overrides.enableBlobStorage = true;
    }
  }

  currentFlags = {
    ...DEFAULT_FLAGS,
    ...envFlags,
    ...overrides,
  };

  return currentFlags;
}

/**
 * Updates feature flags at runtime (for admin overrides)
 */
export function updatePluginFeatureFlags(updates: Partial<PluginFeatureFlags>): void {
  currentFlags = {
    ...getPluginFeatureFlags(),
    ...updates,
  };
}

/**
 * Resets feature flags to defaults
 */
export function resetPluginFeatureFlags(): void {
  currentFlags = null;
}
