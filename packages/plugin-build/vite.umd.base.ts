/**
 * Base Vite UMD Configuration for NAAP Plugins
 *
 * All plugins MUST extend this config to ensure:
 * 1. React/ReactDOM are externalized (use shell's version)
 * 2. JSX runtime is externalized (prevents React version conflicts)
 * 3. Consistent build output format
 * 4. Post-build validation catches issues before deployment
 *
 * Usage in plugin vite.config.umd.ts:
 * ```typescript
 * import { createPluginUMDConfig } from '@naap/plugin-build';
 *
 * export default createPluginUMDConfig({
 *   name: 'my-plugin',
 *   displayName: 'My Plugin',
 *   globalName: 'NaapPluginMyPlugin',
 * });
 * ```
 */

import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

/**
 * Forbidden patterns that indicate bundled React internals.
 * If found, the build should fail because plugins will break
 * when loaded in a shell with a different React version.
 */
const FORBIDDEN_PATTERNS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  'react-jsx-runtime.production',
  'react-jsx-runtime.development',
  'react-jsx-dev-runtime.production',
  'react-jsx-dev-runtime.development',
] as const;

/**
 * Validates a built UMD bundle to ensure it doesn't contain
 * bundled React internals that would cause version conflicts.
 */
function validateBundle(bundlePath: string, pluginName: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const content = readFileSync(bundlePath, 'utf-8');

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (content.includes(pattern)) {
      errors.push(
        `Bundle contains "${pattern}" - React JSX runtime is bundled instead of externalized.\n` +
        `   This will cause the plugin to fail when loaded in a shell with a different React version.\n` +
        `   Fix: Ensure 'react/jsx-runtime' and 'react/jsx-dev-runtime' are in the 'external' array.`
      );
    }
  }

  // Check UMD wrapper format
  const firstLine = content.split('\n')[0];
  if (!firstLine.includes('globalThis') && !firstLine.includes('self')) {
    errors.push(
      `Bundle may not be a proper UMD format - missing globalThis/self reference.\n` +
      `   Ensure build.lib.formats includes 'umd'.`
    );
  }

  // Check that React globals are referenced
  if (!firstLine.includes('.React')) {
    errors.push(
      `Bundle may not externalize React properly - no .React reference in UMD wrapper.\n` +
      `   Ensure 'react' is in the 'external' array and globals maps it to 'React'.`
    );
  }

  return { valid: errors.length === 0, errors };
}

export interface PluginUMDOptions {
  /** Plugin name in kebab-case (e.g., 'my-plugin') */
  name: string;

  /** Display name for UI (e.g., 'My Plugin') */
  displayName: string;

  /** UMD global name (e.g., 'NaapPluginMyPlugin') */
  globalName: string;

  /** Entry file path (default: './src/mount.tsx') */
  entry?: string;

  /** Output directory (default: 'dist/production') */
  outDir?: string;

  /** Additional external packages */
  additionalExternals?: string[];

  /** Additional globals mapping */
  additionalGlobals?: Record<string, string>;

  /** Custom resolve aliases */
  aliases?: Record<string, string>;
}

/**
 * REQUIRED externals for all NAAP plugins.
 * These ensure plugins use the shell's React instead of bundling their own.
 *
 * CRITICAL: Do NOT remove 'react/jsx-runtime' - this prevents React version
 * conflicts where bundled React 18 JSX runtime fails with React 19 shell.
 */
export const REQUIRED_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
] as const;

/**
 * REQUIRED globals mapping for UMD bundles.
 * Maps import paths to window globals.
 */
export const REQUIRED_GLOBALS: Record<string, string> = {
  'react': 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'react/jsx-runtime': 'React',
  'react/jsx-dev-runtime': 'React',
};

/**
 * Default resolve aliases for NAAP packages
 */
export const DEFAULT_ALIASES = {
  '@naap/plugin-sdk': '../../packages/plugin-sdk/src',
  '@naap/ui': '../../packages/ui/src',
  '@naap/types': '../../packages/types/src',
  '@naap/theme': '../../packages/theme/src',
  '@naap/utils': '../../packages/utils/src',
};

/**
 * Creates a Vite UMD build configuration for a NAAP plugin.
 */
export function createPluginUMDConfig(options: PluginUMDOptions) {
  const {
    name,
    displayName,
    globalName,
    entry = './src/mount.tsx',
    outDir = 'dist/production',
    additionalExternals = [],
    additionalGlobals = {},
    aliases = {},
  } = options;

  return defineConfig(({ mode }) => {
    const isProduction = mode === 'production';

    const generateHash = (content: string): string => {
      return createHash('sha256').update(content).digest('hex').substring(0, 8);
    };

    const config: UserConfig = {
      plugins: [
        react(),
        {
          name: 'umd-manifest',
          closeBundle() {
            if (!isProduction) return;

            if (!existsSync(outDir)) {
              mkdirSync(outDir, { recursive: true });
            }

            const files = readdirSync(outDir);
            const bundleFile = files.find((f: string) => f.endsWith('.js') && !f.endsWith('.map'));
            const stylesFile = files.find((f: string) => f.endsWith('.css'));

            if (!bundleFile) {
              console.error('No bundle file found in output');
              return;
            }

            const bundlePath = path.join(outDir, bundleFile);
            const bundleContent = readFileSync(bundlePath, 'utf-8');
            const bundleHash = generateHash(bundleContent);
            const bundleSize = Buffer.byteLength(bundleContent, 'utf-8');

            // Try to read plugin.json for additional metadata
            let pluginJson: Record<string, unknown> = {};
            const pluginJsonPath = path.resolve(process.cwd(), '../plugin.json');
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
              category: (pluginJson.category as string) || 'general',
              description: pluginJson.description as string,
              buildTime: new Date().toISOString(),
              nodeEnv: 'production',
            };

            writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

            console.log(`\n📦 UMD bundle: ${bundleFile} (${(bundleSize / 1024).toFixed(1)} KB)`);

            // Validate the bundle to catch React version conflicts early
            const validation = validateBundle(bundlePath, name);
            if (!validation.valid) {
              console.error(`\n❌ BUILD VALIDATION FAILED for ${name}:\n`);
              validation.errors.forEach((err, i) => {
                console.error(`   ${i + 1}. ${err}\n`);
              });
              console.error(`\n   The plugin will NOT work correctly when loaded in the shell.`);
              console.error(`   Fix the issues above and rebuild.\n`);
              // Throw to fail the build
              throw new Error(`Plugin build validation failed: ${validation.errors.length} error(s)`);
            } else {
              console.log(`✅ Bundle validated - no bundled React internals`);
            }
          },
        },
      ],
      resolve: {
        alias: {
          ...DEFAULT_ALIASES,
          ...aliases,
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
      },
      build: {
        outDir,
        lib: {
          entry,
          name: globalName,
          fileName: () => `${name}.js`,
          formats: ['umd'],
        },
        rollupOptions: {
          external: [...REQUIRED_EXTERNALS, ...additionalExternals],
          output: {
            globals: {
              ...REQUIRED_GLOBALS,
              ...additionalGlobals,
            },
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

export default createPluginUMDConfig;
