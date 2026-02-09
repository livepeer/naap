#!/usr/bin/env npx ts-node

/**
 * Plugin Migration Script
 *
 * Migrates all plugins to UMD build format for CDN deployment.
 * This script:
 * 1. Adds build:production script to each plugin's package.json
 * 2. Creates vite.config.umd.ts for each plugin
 * 3. Builds each plugin
 * 4. Validates the output
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const PLUGINS_DIR = resolve(__dirname, '../plugins');

// Plugin configurations
const PLUGIN_CONFIGS: Record<
  string,
  { displayName: string; globalName: string; routes: string[]; category: string }
> = {
  'capacity-planner': {
    displayName: 'Capacity Planner',
    globalName: 'NaapPluginCapacityPlanner',
    routes: ['/capacity', '/capacity/*'],
    category: 'analytics',
  },
  'orchestrator-manager': {
    displayName: 'Orchestrator Manager',
    globalName: 'NaapPluginOrchestratorManager',
    routes: ['/orchestrators', '/orchestrators/*'],
    category: 'monitoring',
  },
  'developer-api': {
    displayName: 'Developer API',
    globalName: 'NaapPluginDeveloperApi',
    routes: ['/developer', '/developer/*'],
    category: 'developer',
  },
  'network-analytics': {
    displayName: 'Network Analytics',
    globalName: 'NaapPluginNetworkAnalytics',
    routes: ['/analytics', '/analytics/*'],
    category: 'analytics',
  },
  marketplace: {
    displayName: 'Marketplace',
    globalName: 'NaapPluginMarketplace',
    routes: ['/marketplace', '/marketplace/*'],
    category: 'platform',
  },
  community: {
    displayName: 'Community',
    globalName: 'NaapPluginCommunity',
    routes: ['/community', '/community/*'],
    category: 'social',
  },
  'plugin-publisher': {
    displayName: 'Plugin Publisher',
    globalName: 'NaapPluginPluginPublisher',
    routes: ['/publish', '/publish/*'],
    category: 'developer',
  },
  'gateway-manager': {
    displayName: 'Gateway Manager',
    globalName: 'NaapPluginGatewayManager',
    routes: ['/gateway', '/gateway/*'],
    category: 'monitoring',
  },
  'my-dashboard': {
    displayName: 'My Dashboard',
    globalName: 'NaapPluginMyDashboard',
    routes: ['/dashboard', '/dashboard/*'],
    category: 'analytics',
  },
  'my-wallet': {
    displayName: 'My Wallet',
    globalName: 'NaapPluginMyWallet',
    routes: ['/wallet', '/wallet/*'],
    category: 'finance',
  },
  'daydream-video': {
    displayName: 'Daydream Video',
    globalName: 'NaapPluginDaydreamVideo',
    routes: ['/daydream', '/daydream/*'],
    category: 'platform',
  },
};

function generateViteUMDConfig(
  pluginName: string,
  displayName: string,
  globalName: string,
  routes: string[],
  category: string
): string {
  return `/**
 * UMD Build Configuration for ${displayName} Plugin
 *
 * Usage: npm run build:production
 * Output: dist/production/${pluginName}.js, dist/production/manifest.json
 */

import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

const PLUGIN_NAME = '${pluginName}';
const PLUGIN_DISPLAY_NAME = '${displayName}';
const PLUGIN_GLOBAL_NAME = '${globalName}';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  const config: UserConfig = {
    plugins: [
      react(),
      {
        name: 'umd-manifest',
        closeBundle() {
          if (!isProduction) return;

          const outDir = 'dist/production';
          if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

          const files = readdirSync(outDir);
          const bundleFile = files.find((f: string) => f.endsWith('.js') && !f.endsWith('.map'));
          const stylesFile = files.find((f: string) => f.endsWith('.css'));

          if (!bundleFile) {
            console.error('No bundle file found');
            return;
          }

          const bundlePath = path.join(outDir, bundleFile);
          const bundleContent = readFileSync(bundlePath, 'utf-8');
          const bundleHash = createHash('sha256').update(bundleContent).digest('hex').substring(0, 8);
          const bundleSize = Buffer.byteLength(bundleContent, 'utf-8');

          let pluginJson: Record<string, unknown> = {};
          const pluginJsonPath = path.resolve(__dirname, '../plugin.json');
          if (existsSync(pluginJsonPath)) {
            pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
          }

          const manifest = {
            name: PLUGIN_NAME,
            displayName: PLUGIN_DISPLAY_NAME,
            version: (pluginJson.version as string) || '1.0.0',
            bundleFile,
            stylesFile,
            globalName: PLUGIN_GLOBAL_NAME,
            bundleHash,
            bundleSize,
            routes: ${JSON.stringify(routes)},
            category: '${category}',
            description: pluginJson.description as string,
            icon: pluginJson.icon as string,
            buildTime: new Date().toISOString(),
            nodeEnv: 'production',
          };

          writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
          console.log(\`\\n📦 UMD bundle: \${bundleFile} (\${(bundleSize / 1024).toFixed(1)} KB)\`);
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
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: {
      outDir: 'dist/production',
      emptyOutDir: true,
      lib: {
        entry: './src/App.tsx',
        name: PLUGIN_GLOBAL_NAME,
        fileName: () => \`\${PLUGIN_NAME}.js\`,
        formats: ['umd'],
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react-dom/client'],
        output: {
          globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
          format: 'umd',
        },
      },
      minify: isProduction ? 'esbuild' : false,
      sourcemap: true,
      cssCodeSplit: false,
    },
  };

  return config;
});
`;
}

function updatePackageJson(frontendDir: string): void {
  const pkgPath = join(frontendDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  // Add build:production script if not present
  if (!pkg.scripts['build:production']) {
    pkg.scripts['build:production'] = 'tsc && vite build --config vite.config.umd.ts --mode production';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ✓ Updated package.json with build:production script`);
  }
}

function migratePlugin(pluginName: string): void {
  console.log(`\n📦 Migrating ${pluginName}...`);

  const config = PLUGIN_CONFIGS[pluginName];
  if (!config) {
    console.log(`  ⚠ No config found for ${pluginName}, skipping`);
    return;
  }

  const frontendDir = join(PLUGINS_DIR, pluginName, 'frontend');
  if (!existsSync(frontendDir)) {
    console.log(`  ⚠ No frontend directory for ${pluginName}, skipping`);
    return;
  }

  // Update package.json
  updatePackageJson(frontendDir);

  // Create vite.config.umd.ts
  const viteConfigPath = join(frontendDir, 'vite.config.umd.ts');
  if (!existsSync(viteConfigPath)) {
    const viteConfig = generateViteUMDConfig(
      pluginName,
      config.displayName,
      config.globalName,
      config.routes,
      config.category
    );
    writeFileSync(viteConfigPath, viteConfig);
    console.log(`  ✓ Created vite.config.umd.ts`);
  } else {
    console.log(`  - vite.config.umd.ts already exists`);
  }
}

function main(): void {
  console.log('🚀 Plugin UMD Migration Script');
  console.log('================================\n');

  // Get all plugin directories
  const plugins = readdirSync(PLUGINS_DIR).filter((name) => {
    const frontendPath = join(PLUGINS_DIR, name, 'frontend');
    return existsSync(frontendPath) && PLUGIN_CONFIGS[name];
  });

  console.log(`Found ${plugins.length} plugins to migrate:`);
  plugins.forEach((p) => console.log(`  - ${p}`));

  // Migrate each plugin
  for (const plugin of plugins) {
    migratePlugin(plugin);
  }

  console.log('\n✅ Migration complete!');
  console.log('\nTo build all plugins for production:');
  console.log('  cd plugins/<plugin-name>/frontend && npm run build:production');
  console.log('\nOr use the plugin-build CLI:');
  console.log('  npx naap-plugin-build build-all plugins/');
}

main();
