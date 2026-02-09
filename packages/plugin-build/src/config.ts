/**
 * Plugin Build Configuration
 *
 * Defines the configuration schema and defaults for building NAAP plugins.
 */

import type { BuildOptions } from 'esbuild';

/**
 * Plugin build configuration
 */
export interface PluginBuildConfig {
  /** Plugin name (used for UMD global name and output files) */
  name: string;

  /** Display name for UI */
  displayName?: string;

  /** Plugin version */
  version: string;

  /** Entry point for the plugin (default: src/main.tsx or src/index.tsx) */
  entry?: string;

  /** Output directory (default: dist/production) */
  outDir?: string;

  /** UMD global name (default: derived from name) */
  globalName?: string;

  /** Routes this plugin handles */
  routes?: string[];

  /** Plugin category */
  category?: string;

  /** Plugin description */
  description?: string;

  /** Plugin icon name */
  icon?: string;

  /** External dependencies (not bundled) - React/ReactDOM are always external */
  external?: string[];

  /** Additional esbuild options */
  esbuild?: Partial<BuildOptions>;

  /** Enable CSS extraction (default: true) */
  extractCss?: boolean;

  /** Generate source maps (default: true) */
  sourcemap?: boolean;

  /** Minify output (default: true for production) */
  minify?: boolean;

  /** Generate production manifest (default: true) */
  generateManifest?: boolean;

  /** Validate output bundle (default: true) */
  validateOutput?: boolean;
}

/**
 * Production manifest generated after build
 */
export interface ProductionManifest {
  /** Plugin name (kebab-case) */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** Semantic version */
  version: string;

  /** Bundle filename (relative to CDN base) */
  bundleFile: string;

  /** Styles filename (relative to CDN base, optional) */
  stylesFile?: string;

  /** Global variable name for UMD bundle */
  globalName: string;

  /** Content hash for cache validation */
  bundleHash: string;

  /** Bundle size in bytes */
  bundleSize: number;

  /** Styles size in bytes (optional) */
  stylesSize?: number;

  /** Routes this plugin handles */
  routes: string[];

  /** Plugin category */
  category?: string;

  /** Plugin description */
  description?: string;

  /** Plugin icon name */
  icon?: string;

  /** Build timestamp */
  buildTime: string;

  /** Node environment used for build */
  nodeEnv: string;
}

/**
 * Build result returned after successful build
 */
export interface BuildResult {
  /** Path to the bundle file */
  bundlePath: string;

  /** Path to the styles file (if CSS was extracted) */
  stylesPath?: string;

  /** Path to the production manifest */
  manifestPath?: string;

  /** Generated production manifest */
  manifest: ProductionManifest;

  /** Build duration in milliseconds */
  duration: number;

  /** Warnings encountered during build */
  warnings: string[];
}

/**
 * Default external dependencies (React ecosystem)
 */
export const DEFAULT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

/**
 * Converts a plugin name to a valid UMD global name
 * @param name Plugin name (e.g., 'my-plugin')
 * @returns UMD global name (e.g., 'NaapPluginMyPlugin')
 */
export function toGlobalName(name: string): string {
  // Convert kebab-case to PascalCase and prefix with NaapPlugin
  const pascalCase = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `NaapPlugin${pascalCase}`;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<PluginBuildConfig> = {
  outDir: 'dist/production',
  extractCss: true,
  sourcemap: true,
  minify: true,
  generateManifest: true,
  validateOutput: true,
  routes: [],
};

/**
 * Validates and normalizes a plugin build configuration
 */
export function normalizeConfig(config: PluginBuildConfig): Required<PluginBuildConfig> {
  if (!config.name) {
    throw new Error('Plugin name is required');
  }
  if (!config.version) {
    throw new Error('Plugin version is required');
  }

  return {
    name: config.name,
    displayName: config.displayName || config.name,
    version: config.version,
    entry: config.entry || 'src/main.tsx',
    outDir: config.outDir || DEFAULT_CONFIG.outDir!,
    globalName: config.globalName || toGlobalName(config.name),
    routes: config.routes || DEFAULT_CONFIG.routes!,
    category: config.category || 'other',
    description: config.description || '',
    icon: config.icon || 'puzzle-piece',
    external: [...DEFAULT_EXTERNALS, ...(config.external || [])],
    esbuild: config.esbuild || {},
    extractCss: config.extractCss ?? DEFAULT_CONFIG.extractCss!,
    sourcemap: config.sourcemap ?? DEFAULT_CONFIG.sourcemap!,
    minify: config.minify ?? DEFAULT_CONFIG.minify!,
    generateManifest: config.generateManifest ?? DEFAULT_CONFIG.generateManifest!,
    validateOutput: config.validateOutput ?? DEFAULT_CONFIG.validateOutput!,
  };
}

/**
 * Loads plugin configuration from plugin.json or package.json
 */
export async function loadPluginConfig(pluginDir: string): Promise<PluginBuildConfig> {
  const { readJson, pathExists } = await import('fs-extra');
  const { join } = await import('path');

  // Try plugin.json first
  const pluginJsonPath = join(pluginDir, 'plugin.json');
  if (await pathExists(pluginJsonPath)) {
    const manifest = await readJson(pluginJsonPath);
    return {
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      routes: manifest.frontend?.routes || [],
      category: manifest.category,
      description: manifest.description,
      icon: manifest.icon,
    };
  }

  // Fall back to package.json
  const packageJsonPath = join(pluginDir, 'package.json');
  if (await pathExists(packageJsonPath)) {
    const pkg = await readJson(packageJsonPath);
    return {
      name: pkg.name.replace(/^@naap\/plugin-/, ''),
      displayName: pkg.displayName || pkg.name,
      version: pkg.version,
      description: pkg.description,
    };
  }

  throw new Error(`No plugin.json or package.json found in ${pluginDir}`);
}
