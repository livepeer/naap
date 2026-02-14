/**
 * Plugin Storage Service
 *
 * Manages plugin assets in Vercel Blob storage.
 * Provides upload, download, and management of plugin bundles.
 */

import { getStorageAdapter, type StorageAdapter, type UploadOptions } from '../storage/blob';
import { createHash } from 'crypto';

/**
 * Plugin asset types
 */
export type PluginAssetType = 'bundle' | 'styles' | 'sourcemap' | 'manifest' | 'icon';

/**
 * Plugin asset information
 */
export interface PluginAsset {
  /** Asset type */
  type: PluginAssetType;

  /** Asset filename */
  filename: string;

  /** Asset content */
  content: Buffer | Blob;

  /** Content type (MIME) */
  contentType: string;

  /** Content hash (optional, will be computed if not provided) */
  hash?: string;
}

/**
 * Plugin deployment result
 */
export interface PluginDeploymentResult {
  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Bundle URL on CDN */
  bundleUrl: string;

  /** Styles URL on CDN (optional) */
  stylesUrl?: string;

  /** Sourcemap URL on CDN (optional) */
  sourcemapUrl?: string;

  /** Content hash of bundle */
  bundleHash: string;

  /** Bundle size in bytes */
  bundleSize: number;

  /** Deployment timestamp */
  deployedAt: Date;

  /** All deployed asset URLs */
  assets: Record<PluginAssetType, string>;
}

/**
 * Plugin version info for listing
 */
export interface PluginVersionInfo {
  version: string;
  bundleUrl: string;
  stylesUrl?: string;
  bundleHash: string;
  bundleSize: number;
  deployedAt: Date;
}

/**
 * Storage path configuration
 */
const STORAGE_PREFIX = 'plugins';

/**
 * Content types for different asset types
 */
const CONTENT_TYPES: Record<PluginAssetType, string> = {
  bundle: 'application/javascript',
  styles: 'text/css',
  sourcemap: 'application/json',
  manifest: 'application/json',
  icon: 'image/svg+xml',
};

/**
 * Cache control settings
 */
const CACHE_CONTROL = {
  // Immutable for hashed files (1 year)
  immutable: 'public, max-age=31536000, immutable',
  // Short cache for manifest (5 minutes)
  manifest: 'public, max-age=300',
};

/**
 * Plugin Storage Service
 *
 * Manages plugin assets in Vercel Blob storage.
 */
export class PluginStorage {
  private storage: StorageAdapter;

  constructor(storage?: StorageAdapter) {
    this.storage = storage || getStorageAdapter();
  }

  /**
   * Uploads a plugin version to storage
   *
   * @param name Plugin name
   * @param version Plugin version
   * @param assets Array of assets to upload
   * @returns Deployment result with CDN URLs
   */
  async uploadPlugin(
    name: string,
    version: string,
    assets: PluginAsset[]
  ): Promise<PluginDeploymentResult> {
    const deployedAssets: Partial<Record<PluginAssetType, string>> = {};
    let bundleHash = '';
    let bundleSize = 0;

    // Validate required assets
    const bundleAsset = assets.find((a) => a.type === 'bundle');
    if (!bundleAsset) {
      throw new Error('Bundle asset is required');
    }

    // Upload each asset
    for (const asset of assets) {
      const path = this.getAssetPath(name, version, asset);
      const hash = asset.hash || this.computeHash(asset.content);

      // Generate cache-appropriate options
      const options: UploadOptions = {
        contentType: asset.contentType || CONTENT_TYPES[asset.type],
        cacheControl:
          asset.type === 'manifest'
            ? CACHE_CONTROL.manifest
            : CACHE_CONTROL.immutable,
        addRandomSuffix: false, // We want deterministic URLs
        access: 'public',
      };

      const result = await this.storage.upload(asset.content, path, options);
      deployedAssets[asset.type] = result.url;

      // Track bundle info
      if (asset.type === 'bundle') {
        bundleHash = hash;
        bundleSize = this.getContentSize(asset.content);
      }
    }

    return {
      name,
      version,
      bundleUrl: deployedAssets.bundle!,
      stylesUrl: deployedAssets.styles,
      sourcemapUrl: deployedAssets.sourcemap,
      bundleHash,
      bundleSize,
      deployedAt: new Date(),
      assets: deployedAssets as Record<PluginAssetType, string>,
    };
  }

  /**
   * Deletes a plugin version from storage
   *
   * @param name Plugin name
   * @param version Plugin version
   */
  async deleteVersion(name: string, version: string): Promise<void> {
    const prefix = `${STORAGE_PREFIX}/${name}/${version}/`;
    const assets = await this.storage.list(prefix);

    await Promise.all(assets.map((asset) => this.storage.delete(asset.url)));
  }

  /**
   * Lists all versions of a plugin
   *
   * @param name Plugin name
   * @returns Array of version info
   */
  async listVersions(name: string): Promise<PluginVersionInfo[]> {
    const prefix = `${STORAGE_PREFIX}/${name}/`;
    const assets = await this.storage.list(prefix);

    // Group assets by version
    const versionMap = new Map<string, PluginVersionInfo>();

    for (const asset of assets) {
      // Extract version from URL path
      const match = asset.url.match(new RegExp(`${prefix}([^/]+)/`));
      if (!match) continue;

      const version = match[1];
      const isBundle = asset.url.endsWith('.js') && !asset.url.endsWith('.map');
      const isStyles = asset.url.endsWith('.css');

      if (!versionMap.has(version)) {
        versionMap.set(version, {
          version,
          bundleUrl: '',
          bundleHash: '',
          bundleSize: 0,
          deployedAt: asset.lastModified,
        });
      }

      const info = versionMap.get(version)!;
      if (isBundle) {
        info.bundleUrl = asset.url;
        info.bundleSize = asset.size;
        // Extract hash from filename
        const hashMatch = asset.url.match(/\.([a-f0-9]{8})\.js$/);
        if (hashMatch) {
          info.bundleHash = hashMatch[1];
        }
      } else if (isStyles) {
        info.stylesUrl = asset.url;
      }
    }

    return Array.from(versionMap.values()).filter((v) => v.bundleUrl);
  }

  /**
   * Checks if a plugin version exists
   *
   * @param name Plugin name
   * @param version Plugin version
   * @returns True if version exists
   */
  async versionExists(name: string, version: string): Promise<boolean> {
    const versions = await this.listVersions(name);
    return versions.some((v) => v.version === version);
  }

  /**
   * Gets the public URL for a plugin asset
   *
   * @param name Plugin name
   * @param version Plugin version
   * @param filename Asset filename
   * @returns Public URL
   */
  getPublicUrl(name: string, version: string, filename: string): string {
    // Note: This returns the logical path. The actual CDN URL is determined
    // by the storage adapter after upload.
    return `${STORAGE_PREFIX}/${name}/${version}/${filename}`;
  }

  /**
   * Gets the storage path for an asset
   */
  private getAssetPath(name: string, version: string, asset: PluginAsset): string {
    return `${STORAGE_PREFIX}/${name}/${version}/${asset.filename}`;
  }

  /**
   * Computes content hash
   */
  private computeHash(content: Buffer | Blob): string {
    if (content instanceof Blob) {
      // For Blobs, we can't compute hash synchronously
      // Return empty string, caller should provide hash
      return '';
    }
    return createHash('sha256').update(content).digest('hex').substring(0, 8);
  }

  /**
   * Gets content size in bytes
   */
  private getContentSize(content: Buffer | Blob): number {
    if (content instanceof Blob) {
      return content.size;
    }
    return content.length;
  }
}

/**
 * CDN URL utilities
 */
export const CDNUtils = {
  /**
   * Generates CDN URL from logical path
   */
  getCDNUrl(baseCdnUrl: string, path: string): string {
    return `${baseCdnUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  },

  /**
   * Extracts version from CDN URL
   */
  extractVersion(url: string): string | null {
    const match = url.match(/\/plugins\/[^/]+\/([^/]+)\//);
    return match ? match[1] : null;
  },

  /**
   * Extracts plugin name from CDN URL
   */
  extractPluginName(url: string): string | null {
    const match = url.match(/\/plugins\/([^/]+)\//);
    return match ? match[1] : null;
  },

  /**
   * Checks if URL is a CDN URL
   */
  isCDNUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const isAllowedHost =
        parsed.hostname.endsWith('.vercel-storage.com') ||
        parsed.hostname.endsWith('.vercel.app') ||
        parsed.hostname === 'cdn.naap.io';
      return parsed.pathname.includes('/plugins/') && isAllowedHost;
    } catch {
      return false;
    }
  },
};

// Singleton instance
let pluginStorageInstance: PluginStorage | null = null;

/**
 * Gets the singleton PluginStorage instance
 */
export function getPluginStorage(): PluginStorage {
  if (!pluginStorageInstance) {
    pluginStorageInstance = new PluginStorage();
  }
  return pluginStorageInstance;
}
