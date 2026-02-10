/**
 * Plugin Registry Service
 *
 * Manages plugin manifests, versions, and CDN URLs for the plugin system.
 */

import { getStorageAdapter } from '@/lib/storage';
import type { RuntimePlugin } from '@naap/types';

export interface PluginVersion {
  version: string;
  bundleUrl: string;
  checksum: string;
  publishedAt: Date;
  size: number;
  changelog?: string;
}

// Use the canonical RuntimePlugin type; alias as PluginManifest for registry compat
export type PluginManifest = RuntimePlugin;

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  versions: PluginVersion[];
  currentVersion: string;
  bundleUrl: string;
  installedAt: Date;
  updatedAt: Date;
  enabled: boolean;
}

export interface RegisterPluginOptions {
  manifest: PluginManifest;
  bundleFile: Buffer | Blob;
  checksum: string;
}

export interface PluginRegistryService {
  register(options: RegisterPluginOptions): Promise<PluginRegistryEntry>;
  unregister(pluginName: string): Promise<void>;
  getPlugin(pluginName: string): Promise<PluginRegistryEntry | null>;
  listPlugins(): Promise<PluginRegistryEntry[]>;
  updateVersion(pluginName: string, options: RegisterPluginOptions): Promise<PluginRegistryEntry>;
  enable(pluginName: string): Promise<void>;
  disable(pluginName: string): Promise<void>;
}

// In-memory cache with 5 minute TTL
const registryCache = new Map<string, { entry: PluginRegistryEntry; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Clear expired cache entries
 */
function clearExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of registryCache.entries()) {
    if (value.expiry < now) {
      registryCache.delete(key);
    }
  }
}

/**
 * Get plugin from cache
 */
function getFromCache(name: string): PluginRegistryEntry | null {
  const cached = registryCache.get(name);
  if (cached && cached.expiry > Date.now()) {
    return cached.entry;
  }
  registryCache.delete(name);
  return null;
}

/**
 * Set plugin in cache
 */
function setInCache(name: string, entry: PluginRegistryEntry): void {
  registryCache.set(name, { entry, expiry: Date.now() + CACHE_TTL });
}

/**
 * Create plugin registry service
 */
export function createPluginRegistry(): PluginRegistryService {
  const storage = getStorageAdapter();

  const getManifestPath = (name: string) => `plugins/${name}/manifest.json`;
  const getBundlePath = (name: string, version: string) => `plugins/${name}/bundles/${version}/bundle.js`;

  return {
    async register(options: RegisterPluginOptions): Promise<PluginRegistryEntry> {
      const { manifest, bundleFile, checksum } = options;
      const bundlePath = getBundlePath(manifest.name, manifest.version);

      // Upload bundle to storage
      const bundleResult = await storage.upload(
        bundleFile instanceof Blob ? bundleFile : new Blob([bundleFile]),
        bundlePath,
        { contentType: 'application/javascript' }
      );

      const version: PluginVersion = {
        version: manifest.version,
        bundleUrl: bundleResult.url,
        checksum,
        publishedAt: new Date(),
        size: bundleResult.size,
      };

      const entry: PluginRegistryEntry = {
        manifest,
        versions: [version],
        currentVersion: manifest.version,
        bundleUrl: bundleResult.url,
        installedAt: new Date(),
        updatedAt: new Date(),
        enabled: manifest.enabled,
      };

      // Save manifest
      await storage.upload(
        new Blob([JSON.stringify(entry, null, 2)]),
        getManifestPath(manifest.name),
        { contentType: 'application/json', addRandomSuffix: false }
      );

      setInCache(manifest.name, entry);
      return entry;
    },

    async unregister(pluginName: string): Promise<void> {
      const entry = await this.getPlugin(pluginName);
      if (!entry) return;

      // Delete all version bundles
      for (const version of entry.versions) {
        await storage.delete(version.bundleUrl);
      }

      // Delete manifest and all plugin files
      const files = await storage.list(`plugins/${pluginName}/`);
      for (const file of files) {
        await storage.delete(file.url);
      }

      registryCache.delete(pluginName);
    },

    async getPlugin(pluginName: string): Promise<PluginRegistryEntry | null> {
      // Check cache
      const cached = getFromCache(pluginName);
      if (cached) return cached;

      try {
        const files = await storage.list(`plugins/${pluginName}/`);
        const manifestFile = files.find(f => f.url.includes('manifest.json'));

        if (!manifestFile) return null;

        // Fetch manifest content
        const response = await fetch(manifestFile.url);
        if (!response.ok) return null;

        const entry = await response.json() as PluginRegistryEntry;
        entry.installedAt = new Date(entry.installedAt);
        entry.updatedAt = new Date(entry.updatedAt);
        entry.versions = entry.versions.map(v => ({
          ...v,
          publishedAt: new Date(v.publishedAt),
        }));

        setInCache(pluginName, entry);
        return entry;
      } catch {
        return null;
      }
    },

    async listPlugins(): Promise<PluginRegistryEntry[]> {
      clearExpiredCache();

      try {
        const files = await storage.list('plugins/');
        const manifestFiles = files.filter(f => f.url.includes('manifest.json'));

        const entries: PluginRegistryEntry[] = [];
        for (const file of manifestFiles) {
          try {
            const response = await fetch(file.url);
            if (response.ok) {
              const entry = await response.json() as PluginRegistryEntry;
              entries.push(entry);
            }
          } catch {
            // Skip invalid manifests
          }
        }

        return entries;
      } catch {
        return [];
      }
    },

    async updateVersion(pluginName: string, options: RegisterPluginOptions): Promise<PluginRegistryEntry> {
      const existing = await this.getPlugin(pluginName);
      if (!existing) {
        return this.register(options);
      }

      const { manifest, bundleFile, checksum } = options;
      const bundlePath = getBundlePath(manifest.name, manifest.version);

      // Upload new bundle
      const bundleResult = await storage.upload(
        bundleFile instanceof Blob ? bundleFile : new Blob([bundleFile]),
        bundlePath,
        { contentType: 'application/javascript' }
      );

      const newVersion: PluginVersion = {
        version: manifest.version,
        bundleUrl: bundleResult.url,
        checksum,
        publishedAt: new Date(),
        size: bundleResult.size,
      };

      // Update entry
      const entry: PluginRegistryEntry = {
        ...existing,
        manifest,
        versions: [...existing.versions, newVersion],
        currentVersion: manifest.version,
        bundleUrl: bundleResult.url,
        updatedAt: new Date(),
      };

      // Save updated manifest
      await storage.upload(
        new Blob([JSON.stringify(entry, null, 2)]),
        getManifestPath(manifest.name),
        { contentType: 'application/json', addRandomSuffix: false }
      );

      setInCache(manifest.name, entry);
      return entry;
    },

    async enable(pluginName: string): Promise<void> {
      const entry = await this.getPlugin(pluginName);
      if (!entry) throw new Error(`Plugin ${pluginName} not found`);

      entry.enabled = true;
      entry.manifest.enabled = true;
      entry.updatedAt = new Date();

      await storage.upload(
        new Blob([JSON.stringify(entry, null, 2)]),
        getManifestPath(pluginName),
        { contentType: 'application/json', addRandomSuffix: false }
      );

      setInCache(pluginName, entry);
    },

    async disable(pluginName: string): Promise<void> {
      const entry = await this.getPlugin(pluginName);
      if (!entry) throw new Error(`Plugin ${pluginName} not found`);

      entry.enabled = false;
      entry.manifest.enabled = false;
      entry.updatedAt = new Date();

      await storage.upload(
        new Blob([JSON.stringify(entry, null, 2)]),
        getManifestPath(pluginName),
        { contentType: 'application/json', addRandomSuffix: false }
      );

      setInCache(pluginName, entry);
    },
  };
}

// Singleton instance
let registryInstance: PluginRegistryService | null = null;

export function getPluginRegistry(): PluginRegistryService {
  if (!registryInstance) {
    registryInstance = createPluginRegistry();
  }
  return registryInstance;
}
