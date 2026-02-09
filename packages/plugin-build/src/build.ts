/**
 * Plugin Build Logic
 *
 * Builds NAAP plugins as UMD bundles using esbuild.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'crypto';
import { join } from 'path';
import { readFile, writeFile, mkdir, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import type {
  PluginBuildConfig,
  BuildResult,
  ProductionManifest,
} from './config.js';
import { normalizeConfig } from './config.js';

/**
 * CSS extraction plugin for esbuild
 */
function cssExtractionPlugin(cssContent: { content: string }): esbuild.Plugin {
  return {
    name: 'css-extraction',
    setup(build) {
      // Collect CSS from .css imports
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const content = await readFile(args.path, 'utf-8');
        cssContent.content += content + '\n';
        return {
          contents: '', // Don't include CSS in JS bundle
          loader: 'text',
        };
      });
    },
  };
}

/**
 * React external plugin - handles React as external dependency
 */
function reactExternalPlugin(): esbuild.Plugin {
  return {
    name: 'react-external',
    setup(build) {
      // Mark react packages as external and map to globals
      build.onResolve({ filter: /^react$/ }, () => ({
        path: 'react',
        namespace: 'external-react',
      }));
      build.onResolve({ filter: /^react-dom/ }, () => ({
        path: 'react-dom',
        namespace: 'external-react-dom',
      }));
      build.onResolve({ filter: /^react\/jsx/ }, () => ({
        path: 'react',
        namespace: 'external-react',
      }));
      build.onLoad({ filter: /.*/, namespace: 'external-react' }, () => ({
        contents: 'module.exports = window.React',
        loader: 'js',
      }));
      build.onLoad({ filter: /.*/, namespace: 'external-react-dom' }, () => ({
        contents: 'module.exports = window.ReactDOM',
        loader: 'js',
      }));
    },
  };
}

/**
 * Generates content hash for a file
 */
function generateHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 8);
}


/**
 * Builds a NAAP plugin as a UMD bundle
 *
 * @param config Plugin build configuration
 * @param pluginDir Directory containing the plugin source
 * @returns Build result
 */
export async function buildPlugin(
  config: PluginBuildConfig,
  pluginDir: string
): Promise<BuildResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  // Normalize configuration
  const normalizedConfig = normalizeConfig(config);
  const { name, version, globalName, outDir, entry, minify, sourcemap } = normalizedConfig;

  // Resolve paths
  const entryPath = join(pluginDir, entry);
  const outputDir = join(pluginDir, outDir);

  // Check entry file exists
  if (!existsSync(entryPath)) {
    // Try alternative entry points
    const alternatives = ['src/main.tsx', 'src/index.tsx', 'src/main.ts', 'src/index.ts'];
    let found = false;
    for (const alt of alternatives) {
      const altPath = join(pluginDir, alt);
      if (existsSync(altPath)) {
        normalizedConfig.entry = alt;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }
  }

  const resolvedEntryPath = join(pluginDir, normalizedConfig.entry);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // CSS collection
  const cssContent = { content: '' };

  // Build banner
  const banner = `/**
 * Plugin: ${normalizedConfig.displayName}
 * Version: ${version}
 * Build: ${new Date().toISOString()}
 */`;

  // Build with esbuild
  const result = await esbuild.build({
    entryPoints: [resolvedEntryPath],
    bundle: true,
    format: 'iife',
    globalName: globalName,
    platform: 'browser',
    target: ['es2020'],
    minify: minify,
    sourcemap: sourcemap ? 'linked' : false,
    metafile: true,
    write: false,
    banner: {
      js: banner,
    },
    plugins: [
      reactExternalPlugin(),
      normalizedConfig.extractCss ? cssExtractionPlugin(cssContent) : undefined,
    ].filter(Boolean) as esbuild.Plugin[],
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.jsx': 'jsx',
      '.js': 'js',
      '.css': 'css',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
    },
    define: {
      'process.env.NODE_ENV': minify ? '"production"' : '"development"',
    },
    ...normalizedConfig.esbuild,
  });

  // Process warnings
  for (const warning of result.warnings) {
    warnings.push(warning.text);
  }

  // Get bundle content
  const bundleOutput = result.outputFiles?.find((f) => f.path.endsWith('.js'));
  if (!bundleOutput) {
    throw new Error('No bundle output generated');
  }

  // Generate content hash
  const bundleHash = generateHash(Buffer.from(bundleOutput.contents));

  // Create output filenames with hash
  const bundleFileName = `${name}.${bundleHash}.js`;
  const stylesFileName = cssContent.content ? `${name}.${bundleHash}.css` : undefined;

  // Write bundle
  const bundlePath = join(outputDir, bundleFileName);
  await writeFile(bundlePath, bundleOutput.contents);

  // Write sourcemap if exists
  const mapOutput = result.outputFiles?.find((f) => f.path.endsWith('.js.map'));
  if (mapOutput && sourcemap) {
    await writeFile(`${bundlePath}.map`, mapOutput.contents);
  }

  // Write CSS if extracted
  let stylesPath: string | undefined;
  if (stylesFileName && cssContent.content.trim()) {
    stylesPath = join(outputDir, stylesFileName);
    await writeFile(stylesPath, cssContent.content);
  }

  // Get file sizes
  const bundleStats = await stat(bundlePath);
  const stylesStats = stylesPath ? await stat(stylesPath) : null;

  // Generate production manifest
  const manifest: ProductionManifest = {
    name,
    displayName: normalizedConfig.displayName,
    version,
    bundleFile: bundleFileName,
    stylesFile: stylesFileName,
    globalName,
    bundleHash,
    bundleSize: bundleStats.size,
    stylesSize: stylesStats?.size,
    routes: normalizedConfig.routes,
    category: normalizedConfig.category,
    description: normalizedConfig.description,
    icon: normalizedConfig.icon,
    buildTime: new Date().toISOString(),
    nodeEnv: minify ? 'production' : 'development',
  };

  // Write manifest
  let manifestPath: string | undefined;
  if (normalizedConfig.generateManifest) {
    manifestPath = join(outputDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  // Validate output if enabled
  if (normalizedConfig.validateOutput) {
    const validationErrors = await validateBundle(bundlePath, globalName);
    if (validationErrors.length > 0) {
      throw new Error(`Bundle validation failed:\n${validationErrors.join('\n')}`);
    }
  }

  return {
    bundlePath,
    stylesPath,
    manifestPath,
    manifest,
    duration: Date.now() - startTime,
    warnings,
  };
}

/**
 * Validates a built UMD bundle
 */
export async function validateBundle(
  bundlePath: string,
  globalName: string
): Promise<string[]> {
  const errors: string[] = [];

  // Check file exists
  if (!existsSync(bundlePath)) {
    errors.push(`Bundle file not found: ${bundlePath}`);
    return errors;
  }

  // Read bundle content
  const content = await readFile(bundlePath, 'utf-8');

  // Check it's not empty
  if (content.trim().length === 0) {
    errors.push('Bundle is empty');
    return errors;
  }

  // Check for global name
  if (!content.includes(globalName)) {
    errors.push(`Bundle does not contain expected global name: ${globalName}`);
  }

  // Check for mount function
  if (!content.includes('mount')) {
    errors.push('Bundle does not appear to export a mount function');
  }

  // Check bundle size (warn if too large)
  const stats = await stat(bundlePath);
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (stats.size > maxSize) {
    errors.push(`Bundle size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds recommended maximum (5MB)`);
  }

  return errors;
}

/**
 * Builds all plugins in a directory
 */
export async function buildAllPlugins(
  pluginsDir: string,
  options: { parallel?: boolean; filter?: string[] } = {}
): Promise<Map<string, BuildResult | Error>> {
  const results = new Map<string, BuildResult | Error>();

  // Find all plugin directories
  const entries = await readdir(pluginsDir, { withFileTypes: true });
  const pluginDirs = entries
    .filter((e) => e.isDirectory())
    .filter((e) => !options.filter || options.filter.includes(e.name))
    .map((e) => e.name);

  // Build function for a single plugin
  const buildOne = async (pluginName: string): Promise<void> => {
    const pluginDir = join(pluginsDir, pluginName, 'frontend');
    
    // Check if frontend directory exists
    if (!existsSync(pluginDir)) {
      results.set(pluginName, new Error(`No frontend directory found for ${pluginName}`));
      return;
    }

    try {
      // Load config from plugin.json in parent directory
      const { loadPluginConfig } = await import('./config.js');
      const config = await loadPluginConfig(join(pluginsDir, pluginName));
      const result = await buildPlugin(config, pluginDir);
      results.set(pluginName, result);
    } catch (error) {
      results.set(pluginName, error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Build plugins
  if (options.parallel) {
    await Promise.all(pluginDirs.map(buildOne));
  } else {
    for (const pluginName of pluginDirs) {
      await buildOne(pluginName);
    }
  }

  return results;
}
