/**
 * Shared Vite UMD Build Configuration for NAAP Plugins
 *
 * This module provides a factory function to create consistent Vite configurations
 * for building plugins as UMD bundles. All plugins should use this shared config
 * instead of duplicating the ~130 lines of config.
 *
 * Usage in plugin's vite.config.umd.ts:
 *
 * ```typescript
 * import { createPluginConfig } from '@naap/plugin-build/vite';
 *
 * export default createPluginConfig({
 *   name: 'my-plugin',
 *   displayName: 'My Plugin',
 *   globalName: 'NaapPluginMyPlugin',
 *   defaultCategory: 'platform',
 * });
 * ```
 */

import { defineConfig, type UserConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

/**
 * Plugin configuration options
 */
export interface PluginBuildOptions {
  /** Plugin identifier (e.g., 'my-plugin') */
  name: string;
  /** Human-readable name (e.g., 'My Plugin') */
  displayName: string;
  /** UMD global name (e.g., 'NaapPluginMyPlugin') */
  globalName: string;
  /** Default category if not in plugin.json */
  defaultCategory?: string;
  /** Entry file path relative to frontend dir (default: './src/mount.tsx') */
  entry?: string;
  /** Output directory (default: 'dist/production') */
  outDir?: string;
  /** Additional Vite plugins */
  plugins?: Plugin[];
  /** Additional rollup external dependencies */
  external?: string[];
  /** Additional globals for rollup */
  globals?: Record<string, string>;
  /** Additional path aliases */
  alias?: Record<string, string>;
}

/**
 * Create the manifest generator plugin
 */
function createManifestPlugin(options: PluginBuildOptions): Plugin {
  const { name, displayName, globalName, defaultCategory = 'platform' } = options;

  return {
    name: 'umd-manifest',
    closeBundle() {
      const outDir = options.outDir || 'dist/production';
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const files = readdirSync(outDir);
      const bundleFile = files.find((f: string) => f.endsWith('.js') && !f.endsWith('.map'));
      const stylesFile = files.find((f: string) => f.endsWith('.css'));

      if (!bundleFile) return;

      const bundlePath = path.join(outDir, bundleFile);
      const bundleContent = readFileSync(bundlePath, 'utf-8');
      const bundleHash = createHash('sha256').update(bundleContent).digest('hex').substring(0, 8);
      const bundleSize = Buffer.byteLength(bundleContent, 'utf-8');

      // Read plugin.json for metadata
      let pluginJson: Record<string, unknown> = {};
      const pluginJsonPath = path.resolve(process.cwd(), '..', 'plugin.json');
      if (existsSync(pluginJsonPath)) {
        pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
      }

      const manifest = {
        name,
        displayName,
        version: (pluginJson.version as string) || '1.0.0',
        bundleFile,
        stylesFile,
        globalName,
        bundleHash,
        bundleSize,
        routes: ((pluginJson.frontend as Record<string, unknown>)?.routes as string[]) || [],
        category: (pluginJson.category as string) || defaultCategory,
        description: pluginJson.description as string,
        buildTime: new Date().toISOString(),
        nodeEnv: 'production',
      };

      writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      console.log(`\n📦 UMD bundle: ${bundleFile} (${(bundleSize / 1024).toFixed(1)} KB)`);

      // ========== BUILD VALIDATION ==========
      // Validates bundle doesn't contain bundled React internals
      // which cause version conflicts when loaded in the shell
      const FORBIDDEN = [
        '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
        'react-jsx-runtime.production',
        'react-jsx-runtime.development',
      ];
      const errors: string[] = [];
      for (const pattern of FORBIDDEN) {
        if (bundleContent.includes(pattern)) {
          errors.push(`Contains bundled React internals: "${pattern}"`);
        }
      }
      if (errors.length > 0) {
        console.error(`\n❌ BUILD VALIDATION FAILED for ${name}:`);
        errors.forEach(e => console.error(`   - ${e}`));
        console.error(`\n   Fix: Ensure react/jsx-runtime is in rollupOptions.external\n`);
        throw new Error(`Plugin validation failed`);
      }
      console.log(`✅ Validated: no bundled React internals`);
    },
  };
}

/**
 * Create a Vite configuration for building a NAAP plugin as UMD bundle.
 *
 * @param options - Plugin build options
 * @returns Vite config factory function
 */
export function createPluginConfig(options: PluginBuildOptions) {
  return defineConfig(({ mode }) => {
    const isProduction = mode === 'production';
    const {
      name,
      globalName,
      displayName,
      entry = './src/mount.tsx',
      outDir = 'dist/production',
      plugins: additionalPlugins = [],
      external: additionalExternal = [],
      globals: additionalGlobals = {},
      alias: additionalAlias = {},
    } = options;

    // Standard package aliases - resolve to source for development
    const standardAlias: Record<string, string> = {
      '@naap/plugin-sdk': path.resolve(process.cwd(), '../../../packages/plugin-sdk/src'),
      '@naap/plugin-utils': path.resolve(process.cwd(), '../../../packages/plugin-utils/src'),
      '@naap/ui': path.resolve(process.cwd(), '../../../packages/ui/src'),
      '@naap/types': path.resolve(process.cwd(), '../../../packages/types/src'),
      '@naap/theme': path.resolve(process.cwd(), '../../../packages/theme/src'),
      '@naap/utils': path.resolve(process.cwd(), '../../../packages/utils/src'),
      ...additionalAlias,
    };

    // Standard external dependencies - React must be external
    const standardExternal = [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      ...additionalExternal,
    ];

    // Standard globals for UMD
    const standardGlobals: Record<string, string> = {
      react: 'React',
      'react-dom': 'ReactDOM',
      'react-dom/client': 'ReactDOM',
      'react/jsx-runtime': 'React',
      'react/jsx-dev-runtime': 'React',
      ...additionalGlobals,
    };

    const config: UserConfig = {
      plugins: [
        react(),
        createManifestPlugin(options),
        ...additionalPlugins,
      ],
      resolve: {
        alias: standardAlias,
      },
      css: {
        // Configure PostCSS inline so plugins resolve from THIS package
        // (packages/plugin-build/) instead of the plugin's postcss.config.js.
        // This avoids module-resolution failures in monorepo/Vercel environments
        // where hoisted deps aren't reachable from plugin subdirectories.
        postcss: {
          plugins: [
            tailwindcss({ config: './tailwind.config.js' }),
            autoprefixer(),
          ],
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
      },
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry,
          name: globalName,
          fileName: () => `${name}.js`,
          formats: ['umd'],
        },
        rollupOptions: {
          external: standardExternal,
          output: {
            globals: standardGlobals,
            format: 'umd',
            banner: `/** NAAP Plugin: ${displayName} | Global: ${globalName} */`,
          },
        },
        minify: isProduction ? 'esbuild' : false,
        sourcemap: true,
        cssCodeSplit: false,
      },
    };

    return config;
  });
}

// Re-export vite types for convenience
export type { UserConfig, Plugin } from 'vite';
