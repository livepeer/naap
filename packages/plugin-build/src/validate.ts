/**
 * Plugin Output Validation
 *
 * Validates built plugin bundles to ensure they meet requirements.
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import type { ProductionManifest } from './config.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors (if any) */
  errors: string[];

  /** Validation warnings (non-fatal) */
  warnings: string[];

  /** Bundle analysis info */
  analysis?: BundleAnalysis;
}

/**
 * Bundle analysis information
 */
export interface BundleAnalysis {
  /** Total bundle size in bytes */
  bundleSize: number;

  /** Styles size in bytes (if present) */
  stylesSize?: number;

  /** Whether bundle uses strict mode */
  usesStrictMode: boolean;

  /** Whether bundle appears to be minified */
  isMinified: boolean;

  /** Detected exports */
  exports: string[];

  /** External dependencies detected */
  externals: string[];
}

/**
 * Size thresholds for warnings
 */
const SIZE_THRESHOLDS = {
  warning: 1 * 1024 * 1024, // 1MB
  error: 5 * 1024 * 1024, // 5MB
};

/**
 * Required exports for a valid plugin bundle
 */
const REQUIRED_EXPORTS = ['mount'];

/**
 * Validates a plugin bundle and its manifest
 */
export async function validatePluginBundle(
  bundlePath: string,
  manifestPath?: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let analysis: BundleAnalysis | undefined;

  // Check bundle exists
  if (!existsSync(bundlePath)) {
    errors.push(`Bundle file not found: ${bundlePath}`);
    return { valid: false, errors, warnings };
  }

  // Read and analyze bundle
  const bundleContent = await readFile(bundlePath, 'utf-8');
  const bundleStats = await stat(bundlePath);

  // Size checks
  if (bundleStats.size > SIZE_THRESHOLDS.error) {
    errors.push(
      `Bundle size (${formatSize(bundleStats.size)}) exceeds maximum (${formatSize(SIZE_THRESHOLDS.error)})`
    );
  } else if (bundleStats.size > SIZE_THRESHOLDS.warning) {
    warnings.push(
      `Bundle size (${formatSize(bundleStats.size)}) is larger than recommended (${formatSize(SIZE_THRESHOLDS.warning)})`
    );
  }

  // Content checks
  if (bundleContent.trim().length === 0) {
    errors.push('Bundle is empty');
    return { valid: false, errors, warnings };
  }

  // Analyze bundle
  analysis = analyzeBundle(bundleContent, bundleStats.size);

  // Check required exports
  for (const required of REQUIRED_EXPORTS) {
    if (!analysis.exports.includes(required)) {
      errors.push(`Missing required export: ${required}`);
    }
  }

  // Check for React as external
  if (!analysis.externals.includes('react')) {
    warnings.push('React does not appear to be externalized - this may cause version conflicts');
  }

  // Validate manifest if provided
  if (manifestPath && existsSync(manifestPath)) {
    const manifestErrors = await validateManifest(manifestPath, bundlePath);
    errors.push(...manifestErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    analysis,
  };
}

/**
 * Analyzes a bundle's content
 */
function analyzeBundle(content: string, size: number): BundleAnalysis {
  const exports: string[] = [];
  const externals: string[] = [];

  // Check for strict mode
  const usesStrictMode = content.includes('"use strict"') || content.includes("'use strict'");

  // Check if minified (rough heuristic: low ratio of whitespace to content)
  const whitespaceRatio = (content.match(/\s/g)?.length || 0) / content.length;
  const isMinified = whitespaceRatio < 0.1;

  // Detect exports (common patterns)
  if (content.includes('mount') || content.includes('.mount')) {
    exports.push('mount');
  }
  if (content.includes('unmount') || content.includes('.unmount')) {
    exports.push('unmount');
  }
  if (content.includes('metadata') || content.includes('.metadata')) {
    exports.push('metadata');
  }
  if (content.includes('init') || content.includes('.init')) {
    exports.push('init');
  }

  // Detect externals
  if (content.includes('window.React') || content.includes('global.React')) {
    externals.push('react');
  }
  if (content.includes('window.ReactDOM') || content.includes('global.ReactDOM')) {
    externals.push('react-dom');
  }

  return {
    bundleSize: size,
    usesStrictMode,
    isMinified,
    exports,
    externals,
  };
}

/**
 * Validates a production manifest against the bundle
 */
async function validateManifest(
  manifestPath: string,
  bundlePath: string
): Promise<string[]> {
  const errors: string[] = [];

  try {
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifest: ProductionManifest = JSON.parse(manifestContent);

    // Required fields
    if (!manifest.name) {
      errors.push('Manifest missing required field: name');
    }
    if (!manifest.version) {
      errors.push('Manifest missing required field: version');
    }
    if (!manifest.bundleFile) {
      errors.push('Manifest missing required field: bundleFile');
    }
    if (!manifest.globalName) {
      errors.push('Manifest missing required field: globalName');
    }
    if (!manifest.bundleHash) {
      errors.push('Manifest missing required field: bundleHash');
    }

    // Check bundle hash matches filename
    if (manifest.bundleFile && manifest.bundleHash) {
      if (!manifest.bundleFile.includes(manifest.bundleHash)) {
        errors.push('Bundle filename does not contain content hash');
      }
    }

    // Check routes is an array
    if (manifest.routes && !Array.isArray(manifest.routes)) {
      errors.push('Manifest routes must be an array');
    }

    // Validate version format (semver-ish)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push('Manifest version does not follow semver format');
    }
  } catch (error) {
    errors.push(`Failed to parse manifest: ${error}`);
  }

  return errors;
}

/**
 * Formats bytes as human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Validates all plugins in a directory
 */
export async function validateAllPlugins(
  pluginsDir: string,
  options: { filter?: string[] } = {}
): Promise<Map<string, ValidationResult>> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');
  const results = new Map<string, ValidationResult>();

  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries
    .filter((e) => e.isDirectory())
    .filter((e) => !options.filter || options.filter.includes(e.name))
    .map((e) => e.name);

  for (const pluginName of pluginDirs) {
    const productionDir = join(pluginsDir, pluginName, 'frontend', 'dist', 'production');
    const manifestPath = join(productionDir, 'manifest.json');

    // Find bundle file
    if (!existsSync(productionDir)) {
      results.set(pluginName, {
        valid: false,
        errors: [`No production build found for ${pluginName}`],
        warnings: [],
      });
      continue;
    }

    const files = await readdir(productionDir);
    const bundleFile = files.find((f) => f.endsWith('.js') && !f.endsWith('.map'));

    if (!bundleFile) {
      results.set(pluginName, {
        valid: false,
        errors: [`No bundle file found for ${pluginName}`],
        warnings: [],
      });
      continue;
    }

    const bundlePath = join(productionDir, bundleFile);
    const result = await validatePluginBundle(bundlePath, manifestPath);
    results.set(pluginName, result);
  }

  return results;
}
