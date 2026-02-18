/**
 * Plugin Vite Configuration Factory
 * 
 * Provides standardized Vite configuration for NAAP plugins.
 * Ensures consistency across all plugins for:
 * - Path aliases to shared packages
 * - Build settings
 * - Development server settings
 */

import type { UserConfig } from 'vite';
import path from 'path';

/**
 * Options for creating a plugin Vite configuration
 */
export interface CreatePluginViteConfigOptions {
  /**
   * Plugin name (kebab-case, e.g., 'my-wallet', 'gateway-manager')
   */
  name: string;

  /**
   * Development server port
   */
  port: number;

  /**
   * Path to the plugin directory (usually __dirname)
   */
  pluginDir: string;

  /**
   * Additional path aliases
   */
  additionalAliases?: Record<string, string>;

  /**
   * Whether to include @naap/plugin-sdk in aliases
   * @default true
   */
  includePluginSdk?: boolean;

  /**
   * Custom Vite config overrides
   */
  viteConfigOverrides?: Partial<UserConfig>;
}

/**
 * Get the path to the packages directory relative to a plugin
 * 
 * @param pluginDir - The plugin's directory (__dirname)
 * @returns Path to packages directory
 */
function getPackagesPath(pluginDir: string): string {
  // Plugin structure: plugins/<plugin-name>/frontend/
  // Packages are at: packages/
  return path.resolve(pluginDir, '../../../packages');
}

/**
 * Create standard path aliases for NAAP packages
 */
function createStandardAliases(
  packagesPath: string,
  includePluginSdk: boolean
): Record<string, string> {
  const aliases: Record<string, string> = {
    '@naap/ui': path.join(packagesPath, 'ui/src'),
    '@naap/types': path.join(packagesPath, 'types/src'),
    '@naap/theme': path.join(packagesPath, 'theme/src'),
    '@naap/utils': path.join(packagesPath, 'utils/src'),
    '@naap/config': path.join(packagesPath, 'config/src'),
  };

  if (includePluginSdk) {
    aliases['@naap/plugin-sdk'] = path.join(packagesPath, 'plugin-sdk/src');
  }

  return aliases;
}

/**
 * Create a standardized Vite configuration for NAAP plugins.
 * 
 * @deprecated Use `createPluginConfig()` from `@naap/plugin-build/vite` instead.
 * This function is a legacy factory that is no longer used by any plugin.
 * It will be removed in a future version.
 * 
 * Migration:
 * ```typescript
 * // Before (deprecated):
 * import { createPluginViteConfig } from '@naap/config/vite-plugin';
 * export default defineConfig(createPluginViteConfig({ name: 'myPlugin', port: 3010, pluginDir: __dirname }));
 * 
 * // After (recommended):
 * import { createPluginConfig } from '@naap/plugin-build/vite';
 * export default createPluginConfig({ name: 'my-plugin', displayName: 'My Plugin', globalName: 'NaapPluginMyPlugin' });
 * ```
 */
export function createPluginViteConfig(
  options: CreatePluginViteConfigOptions
): UserConfig {
  const {
    port,
    pluginDir,
    additionalAliases = {},
    includePluginSdk = true,
    viteConfigOverrides = {},
  } = options;

  const packagesPath = getPackagesPath(pluginDir);
  const standardAliases = createStandardAliases(packagesPath, includePluginSdk);

  // Base configuration
  const baseConfig: UserConfig = {
    plugins: [],
    resolve: {
      alias: {
        ...standardAliases,
        ...additionalAliases,
      },
    },
    server: {
      port,
      host: '0.0.0.0',
    },
    build: {
      target: 'esnext',
      minify: false,
      cssCodeSplit: false,
    },
  };

  // Merge with overrides
  return {
    ...baseConfig,
    ...viteConfigOverrides,
    resolve: {
      ...baseConfig.resolve,
      ...viteConfigOverrides.resolve,
      alias: {
        ...standardAliases,
        ...additionalAliases,
        ...(viteConfigOverrides.resolve?.alias as Record<string, string> || {}),
      },
    },
    server: {
      ...baseConfig.server,
      ...viteConfigOverrides.server,
    },
    build: {
      ...baseConfig.build,
      ...viteConfigOverrides.build,
    },
  };
}

/**
 * Export for direct usage in package.json exports
 */
export default createPluginViteConfig;
