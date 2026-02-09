/**
 * Production Manifest Generation
 *
 * Utilities for generating and managing production manifests.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import type { ProductionManifest, PluginBuildConfig } from './config.js';

/**
 * CDN URL template options
 */
export interface CDNUrlOptions {
  /** Base CDN URL (e.g., https://cdn.naap.io/plugins) */
  baseUrl: string;

  /** Plugin name */
  pluginName: string;

  /** Plugin version */
  version: string;

  /** Whether to include version in URL */
  includeVersion?: boolean;
}

/**
 * Generates CDN URLs for a plugin's assets
 */
export function generateCDNUrls(
  manifest: ProductionManifest,
  options: CDNUrlOptions
): { bundleUrl: string; stylesUrl?: string } {
  const { baseUrl, pluginName, version, includeVersion = true } = options;

  // Build base path
  const versionPath = includeVersion ? `/${version}` : '';
  const basePath = `${baseUrl}/${pluginName}${versionPath}`;

  return {
    bundleUrl: `${basePath}/${manifest.bundleFile}`,
    stylesUrl: manifest.stylesFile ? `${basePath}/${manifest.stylesFile}` : undefined,
  };
}

/**
 * Creates a complete production manifest with CDN URLs
 */
export function createProductionManifest(
  config: PluginBuildConfig,
  bundleInfo: {
    bundleFile: string;
    stylesFile?: string;
    bundleHash: string;
    bundleSize: number;
    stylesSize?: number;
  },
  cdnOptions?: CDNUrlOptions
): ProductionManifest {
  const manifest: ProductionManifest = {
    name: config.name,
    displayName: config.displayName || config.name,
    version: config.version,
    bundleFile: bundleInfo.bundleFile,
    stylesFile: bundleInfo.stylesFile,
    globalName: config.globalName || toGlobalName(config.name),
    bundleHash: bundleInfo.bundleHash,
    bundleSize: bundleInfo.bundleSize,
    stylesSize: bundleInfo.stylesSize,
    routes: config.routes || [],
    category: config.category,
    description: config.description,
    icon: config.icon,
    buildTime: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'production',
  };

  return manifest;
}

/**
 * Converts a plugin name to UMD global name
 */
function toGlobalName(name: string): string {
  const pascalCase = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `NaapPlugin${pascalCase}`;
}

/**
 * Generates a content hash for a file
 */
export async function generateFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex').substring(0, 8);
}

/**
 * Reads and parses a production manifest
 */
export async function readManifest(manifestPath: string): Promise<ProductionManifest> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const content = await readFile(manifestPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Writes a production manifest to disk
 */
export async function writeManifest(
  manifestPath: string,
  manifest: ProductionManifest
): Promise<void> {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Updates a manifest with new CDN URLs
 */
export async function updateManifestWithCDN(
  manifestPath: string,
  cdnOptions: CDNUrlOptions
): Promise<ProductionManifest> {
  const manifest = await readManifest(manifestPath);
  const urls = generateCDNUrls(manifest, cdnOptions);

  // Create updated manifest with CDN URLs
  const updatedManifest: ProductionManifest & { bundleUrl?: string; stylesUrl?: string } = {
    ...manifest,
    bundleUrl: urls.bundleUrl,
    stylesUrl: urls.stylesUrl,
  };

  await writeManifest(manifestPath, updatedManifest as ProductionManifest);
  return updatedManifest as ProductionManifest;
}

/**
 * Collects all plugin manifests from a directory
 */
export async function collectManifests(
  pluginsDir: string
): Promise<Map<string, ProductionManifest>> {
  const { readdir } = await import('fs/promises');
  const manifests = new Map<string, ProductionManifest>();

  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const pluginName of pluginDirs) {
    const manifestPath = join(pluginsDir, pluginName, 'frontend', 'dist', 'production', 'manifest.json');
    
    if (existsSync(manifestPath)) {
      try {
        const manifest = await readManifest(manifestPath);
        manifests.set(pluginName, manifest);
      } catch (error) {
        console.warn(`Failed to read manifest for ${pluginName}:`, error);
      }
    }
  }

  return manifests;
}

/**
 * Generates a combined manifest for all plugins
 */
export async function generateCombinedManifest(
  pluginsDir: string,
  cdnBaseUrl: string
): Promise<Record<string, ProductionManifest & { bundleUrl: string; stylesUrl?: string }>> {
  const manifests = await collectManifests(pluginsDir);
  const combined: Record<string, ProductionManifest & { bundleUrl: string; stylesUrl?: string }> = {};

  for (const [pluginName, manifest] of manifests) {
    const urls = generateCDNUrls(manifest, {
      baseUrl: cdnBaseUrl,
      pluginName,
      version: manifest.version,
    });

    combined[pluginName] = {
      ...manifest,
      bundleUrl: urls.bundleUrl,
      stylesUrl: urls.stylesUrl,
    };
  }

  return combined;
}
