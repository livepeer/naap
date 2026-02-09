/**
 * UMD Build Configuration Template for NAAP Plugins
 *
 * This template creates a UMD bundle suitable for CDN deployment.
 * Copy this to your plugin's frontend directory as `vite.config.umd.ts`
 * and update the PLUGIN_NAME constant.
 *
 * Usage:
 *   npm run build:production
 *
 * Output:
 *   dist/production/{pluginName}.{hash}.js
 *   dist/production/{pluginName}.{hash}.css (if styles exist)
 *   dist/production/manifest.json
 */

import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

// ============================================
// CUSTOMIZE THESE VALUES FOR YOUR PLUGIN
// ============================================

const PLUGIN_NAME = 'YOUR_PLUGIN_NAME'; // e.g., 'capacity-planner'
const PLUGIN_DISPLAY_NAME = 'Your Plugin Display Name';
const PLUGIN_GLOBAL_NAME = 'NaapPluginYourPlugin'; // e.g., 'NaapPluginCapacityPlanner'

// ============================================
// Build Configuration
// ============================================

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  // Generate content hash for cache busting
  const generateHash = (content: string): string => {
    return createHash('sha256').update(content).digest('hex').substring(0, 8);
  };

  const config: UserConfig = {
    plugins: [
      react(),
      // Custom plugin to generate production manifest
      {
        name: 'umd-manifest',
        closeBundle() {
          if (!isProduction) return;

          const outDir = 'dist/production';
          if (!existsSync(outDir)) {
            mkdirSync(outDir, { recursive: true });
          }

          // Find the bundle file
          const files = require('fs').readdirSync(outDir);
          const bundleFile = files.find((f: string) => f.endsWith('.js') && !f.endsWith('.map'));
          const stylesFile = files.find((f: string) => f.endsWith('.css'));

          if (!bundleFile) {
            console.error('No bundle file found in output');
            return;
          }

          // Read bundle to compute hash
          const bundlePath = path.join(outDir, bundleFile);
          const bundleContent = readFileSync(bundlePath, 'utf-8');
          const bundleHash = generateHash(bundleContent);
          const bundleSize = Buffer.byteLength(bundleContent, 'utf-8');

          // Read plugin.json from parent directory
          let pluginJson: Record<string, unknown> = {};
          const pluginJsonPath = path.resolve(__dirname, '../plugin.json');
          if (existsSync(pluginJsonPath)) {
            pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
          }

          // Generate manifest
          const manifest = {
            name: PLUGIN_NAME,
            displayName: PLUGIN_DISPLAY_NAME,
            version: (pluginJson.version as string) || '1.0.0',
            bundleFile,
            stylesFile,
            globalName: PLUGIN_GLOBAL_NAME,
            bundleHash,
            bundleSize,
            routes: ((pluginJson.frontend as Record<string, unknown>)?.routes as string[]) || [],
            category: (pluginJson.category as string) || 'other',
            description: pluginJson.description as string,
            icon: pluginJson.icon as string,
            buildTime: new Date().toISOString(),
            nodeEnv: 'production',
          };

          writeFileSync(
            path.join(outDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2)
          );

          console.log(`\n📦 UMD bundle created: ${bundleFile}`);
          console.log(`   Size: ${(bundleSize / 1024).toFixed(1)} KB`);
          console.log(`   Hash: ${bundleHash}`);
        },
      },
    ],
    resolve: {
      alias: {
        '@naap/plugin-sdk': path.resolve(__dirname, '../../../packages/plugin-sdk/src'),
        '@naap/ui': path.resolve(__dirname, '../../../packages/ui/src'),
        '@naap/types': path.resolve(__dirname, '../../../packages/types/src'),
        '@naap/theme': path.resolve(__dirname, '../../../packages/theme/src'),
        '@naap/utils': path.resolve(__dirname, '../../../packages/utils/src'),
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    build: {
      outDir: 'dist/production',
      lib: {
        entry: './src/main.tsx',
        name: PLUGIN_GLOBAL_NAME,
        fileName: () => `${PLUGIN_NAME}.[hash].js`,
        formats: ['umd'],
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react-dom/client'],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
            'react-dom/client': 'ReactDOM',
          },
          // Ensure UMD wrapper
          format: 'umd',
          // Add banner with plugin info
          banner: `/**
 * NAAP Plugin: ${PLUGIN_DISPLAY_NAME}
 * Global: ${PLUGIN_GLOBAL_NAME}
 * Build: ${new Date().toISOString()}
 */`,
        },
      },
      minify: isProduction ? 'esbuild' : false,
      sourcemap: true,
      cssCodeSplit: false,
    },
  };

  return config;
});
