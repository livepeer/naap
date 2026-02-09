/**
 * CDN URL Utilities
 *
 * Helpers for working with plugin CDN URLs.
 */

/**
 * CDN URL configuration
 */
export interface CDNConfig {
  /** Base URL for plugin assets */
  baseUrl: string;

  /** Whether to include version in path */
  includeVersion: boolean;

  /** Custom URL transformer (for SRI, etc.) */
  transformUrl?: (url: string) => string;
}

/**
 * Default CDN configuration
 */
const defaultConfig: CDNConfig = {
  baseUrl: process.env.NEXT_PUBLIC_PLUGIN_CDN_URL || 'https://cdn.naap.io/plugins',
  includeVersion: true,
};

/**
 * Plugin bundle info from CDN
 */
export interface PluginBundleInfo {
  /** Full CDN URL to bundle */
  bundleUrl: string;

  /** Full CDN URL to styles (if present) */
  stylesUrl?: string;

  /** Full CDN URL to sourcemap (if present) */
  sourcemapUrl?: string;

  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Content hash */
  hash: string;
}

/**
 * Generates CDN URLs for a plugin
 */
export function generatePluginUrls(
  name: string,
  version: string,
  manifest: {
    bundleFile: string;
    stylesFile?: string;
    bundleHash: string;
  },
  config: Partial<CDNConfig> = {}
): PluginBundleInfo {
  const cfg = { ...defaultConfig, ...config };
  const versionPath = cfg.includeVersion ? `/${version}` : '';
  const basePath = `${cfg.baseUrl}/${name}${versionPath}`;

  let bundleUrl = `${basePath}/${manifest.bundleFile}`;
  let stylesUrl = manifest.stylesFile ? `${basePath}/${manifest.stylesFile}` : undefined;
  let sourcemapUrl = `${bundleUrl}.map`;

  // Apply custom transformer if provided
  if (cfg.transformUrl) {
    bundleUrl = cfg.transformUrl(bundleUrl);
    if (stylesUrl) {
      stylesUrl = cfg.transformUrl(stylesUrl);
    }
    sourcemapUrl = cfg.transformUrl(sourcemapUrl);
  }

  return {
    bundleUrl,
    stylesUrl,
    sourcemapUrl,
    name,
    version,
    hash: manifest.bundleHash,
  };
}

/**
 * Parses a CDN URL to extract plugin info
 */
export function parsePluginUrl(url: string): {
  name: string;
  version: string;
  filename: string;
  hash?: string;
} | null {
  // Match pattern: /plugins/{name}/{version}/{filename}
  const match = url.match(/\/plugins\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;

  const [, name, version, filename] = match;

  // Extract hash from filename (e.g., plugin.abc12345.js)
  const hashMatch = filename.match(/\.([a-f0-9]{8})\.(js|css)$/);

  return {
    name,
    version,
    filename,
    hash: hashMatch ? hashMatch[1] : undefined,
  };
}

/**
 * Validates a CDN URL
 */
export function isValidPluginCDNUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be HTTPS or localhost
    if (parsed.protocol !== 'https:' && !parsed.hostname.includes('localhost')) {
      return false;
    }
    // Must contain plugins path
    if (!parsed.pathname.includes('/plugins/')) {
      return false;
    }
    // Must end with .js
    if (!parsed.pathname.endsWith('.js')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a cache key for a plugin URL
 */
export function getCacheKey(url: string): string {
  const parsed = parsePluginUrl(url);
  if (!parsed) {
    // Fallback to URL hash
    return `plugin_${hashString(url)}`;
  }
  return `plugin_${parsed.name}_${parsed.version}_${parsed.hash || 'latest'}`;
}

/**
 * Simple string hash function
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Gets optimized CDN URL with query params for cache busting
 */
export function getOptimizedUrl(url: string, options: { forceFresh?: boolean } = {}): string {
  const parsed = new URL(url);

  if (options.forceFresh) {
    parsed.searchParams.set('t', Date.now().toString());
  }

  return parsed.toString();
}

/**
 * Preloads plugin resources for faster loading
 */
export function preloadPluginResources(info: PluginBundleInfo): void {
  if (typeof document === 'undefined') return;

  // Preload bundle
  const bundleLink = document.createElement('link');
  bundleLink.rel = 'preload';
  bundleLink.href = info.bundleUrl;
  bundleLink.as = 'script';
  bundleLink.crossOrigin = 'anonymous';
  document.head.appendChild(bundleLink);

  // Preload styles if present
  if (info.stylesUrl) {
    const stylesLink = document.createElement('link');
    stylesLink.rel = 'preload';
    stylesLink.href = info.stylesUrl;
    stylesLink.as = 'style';
    stylesLink.crossOrigin = 'anonymous';
    document.head.appendChild(stylesLink);
  }
}

/**
 * Generates integrity hash for Subresource Integrity (SRI)
 * Note: This should be called with the actual content, not just the URL
 */
export async function generateIntegrityHash(content: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-384', content);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  return `sha384-${hashBase64}`;
}

/**
 * Fetches and validates a plugin bundle
 */
export async function fetchAndValidateBundle(
  url: string,
  expectedHash?: string
): Promise<{ content: string; integrity?: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin bundle: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();

  // Validate hash if provided
  if (expectedHash) {
    const buffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);

    if (actualHash !== expectedHash) {
      throw new Error(`Plugin bundle hash mismatch: expected ${expectedHash}, got ${actualHash}`);
    }
  }

  // Generate integrity for future validation
  const buffer = new TextEncoder().encode(content);
  const integrity = await generateIntegrityHash(buffer);

  return { content, integrity };
}
