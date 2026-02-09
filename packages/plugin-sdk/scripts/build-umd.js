#!/usr/bin/env node

/**
 * Build script for UMD bundle using esbuild
 * 
 * This creates a UMD bundle that can be loaded via script tag.
 * React and ReactDOM are external dependencies (not bundled).
 */

import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Ensure output directory exists
const outDir = join(rootDir, 'dist', 'umd');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const banner = `/**
 * @naap/plugin-sdk UMD Bundle
 * Version: 0.1.0
 * Build: ${new Date().toISOString()}
 * 
 * This bundle is designed for loading plugins via script tag.
 * React and ReactDOM must be available globally.
 */`;

// Build configuration
const buildConfig = {
  entryPoints: [join(rootDir, 'src', 'umd', 'index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'NaapPluginSDK',
  external: ['react', 'react-dom', 'react-dom/client'],
  platform: 'browser',
  target: ['es2020'],
  banner: {
    js: banner
  },
  footer: {
    // Expose as UMD
    js: `
// UMD wrapper
if (typeof module === 'object' && module.exports) {
  module.exports = NaapPluginSDK;
} else if (typeof define === 'function' && define.amd) {
  define([], function() { return NaapPluginSDK; });
}
`
  },
  // Handle React externals
  plugins: [{
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
      build.onLoad({ filter: /.*/, namespace: 'external-react' }, () => ({
        contents: 'module.exports = window.React',
        loader: 'js',
      }));
      build.onLoad({ filter: /.*/, namespace: 'external-react-dom' }, () => ({
        contents: 'module.exports = window.ReactDOM',
        loader: 'js',
      }));
    }
  }],
};

async function build() {
  console.log('Building UMD bundle...');

  try {
    // Development build
    await esbuild.build({
      ...buildConfig,
      outfile: join(outDir, 'naap-plugin-sdk.js'),
      sourcemap: true,
      minify: false,
    });
    console.log('✓ Created naap-plugin-sdk.js');

    // Production build (minified)
    const result = await esbuild.build({
      ...buildConfig,
      outfile: join(outDir, 'naap-plugin-sdk.min.js'),
      sourcemap: true,
      minify: true,
      metafile: true,
    });
    console.log('✓ Created naap-plugin-sdk.min.js');

    // Output bundle size info
    const outputs = result.metafile?.outputs;
    if (outputs) {
      for (const [path, info] of Object.entries(outputs)) {
        if (path.endsWith('.js')) {
          console.log(`  Size: ${(info.bytes / 1024).toFixed(2)} KB`);
        }
      }
    }

    // Create type definitions
    const dtsContent = `/**
 * @naap/plugin-sdk UMD Type Definitions
 */

import type { ComponentType, ReactNode } from 'react';

export interface ShellContext {
  auth: IAuthService;
  notifications: INotificationService;
  navigate: (path: string) => void;
  eventBus: IEventBus;
  theme: IThemeService;
  logger: ILoggerService;
  permissions: IPermissionService;
  integrations: IIntegrationService;
  capabilities?: ICapabilityService;
  shellVersion?: string;
  pluginBasePath?: string;
}

export interface IAuthService {
  getUser: () => { id: string; displayName?: string } | null;
  getToken: () => string | null;
  isAuthenticated: () => boolean;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  login: () => void;
  logout: () => void;
  getCurrentTeam: () => { id: string; name: string } | null;
  getTenant: () => { id: string; name: string } | null;
}

export interface INotificationService {
  success: (message: string, options?: { title?: string; duration?: number }) => void;
  error: (message: string, options?: { title?: string; duration?: number }) => void;
  warning: (message: string, options?: { title?: string; duration?: number }) => void;
  info: (message: string, options?: { title?: string; duration?: number }) => void;
  show: (options: { type: 'success' | 'error' | 'warning' | 'info'; message: string; title?: string }) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export interface IEventBus {
  emit: (event: string, data?: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => () => void;
  off: (event: string, handler: (data: unknown) => void) => void;
  once: (event: string, handler: (data: unknown) => void) => () => void;
}

export interface IThemeService {
  mode: 'light' | 'dark';
  primaryColor: string;
  accentColor: string;
  getMode: () => 'light' | 'dark';
  setMode: (mode: 'light' | 'dark') => void;
  toggle: () => void;
}

export interface ILoggerService {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (context: Record<string, unknown>) => ILoggerService;
}

export interface IPermissionService {
  can: (resource: string, action: string) => boolean;
  hasRole: (role: string) => boolean;
  getRoles: () => string[];
  getPermissions: () => string[];
}

export interface IIntegrationService {
  ai: unknown;
  storage: unknown;
  email: unknown;
  getIntegration: (name: string) => unknown;
  listIntegrations: () => string[];
}

export interface ICapabilityService {
  has: (capability: string) => boolean;
  info: (capability: string) => { available: boolean; configured: boolean; provider?: string };
  getAll: () => Record<string, boolean>;
  hasAll: (...capabilities: string[]) => boolean;
  hasAny: (...capabilities: string[]) => boolean;
}

export type PluginMountFn = (container: HTMLElement, context: ShellContext) => (() => void) | void;

export interface UMDPluginMountOptions<P extends object = object> {
  App: ComponentType<{ context?: ShellContext } & P>;
  wrapper?: ComponentType<{ children: ReactNode; context: ShellContext }>;
  onInit?: (context: ShellContext) => void | Promise<void>;
  onMount?: (context: ShellContext) => void;
  onUnmount?: () => void;
  ErrorBoundary?: ComponentType<{ children: ReactNode }>;
}

export interface ProductionManifest {
  name: string;
  displayName: string;
  version: string;
  bundleUrl: string;
  stylesUrl?: string;
  globalName: string;
  bundleHash: string;
  bundleSize: number;
  routes: string[];
  category?: string;
  description?: string;
  icon?: string;
}

export interface UMDPluginModule {
  mount: PluginMountFn;
  unmount?: () => void;
  metadata?: {
    name: string;
    version: string;
  };
}

export function createUMDPluginMount(
  React: typeof import('react'),
  ReactDOM: typeof import('react-dom/client'),
  options: UMDPluginMountOptions
): UMDPluginModule;

export function createUMDPlugin(
  React: typeof import('react'),
  ReactDOM: typeof import('react-dom/client'),
  options: UMDPluginMountOptions & { name: string; version: string }
): UMDPluginModule;

export function registerUMDPlugin(
  name: string,
  createFn: (
    React: typeof import('react'),
    ReactDOM: typeof import('react-dom/client')
  ) => UMDPluginModule
): void;

declare const _default: {
  createUMDPluginMount: typeof createUMDPluginMount;
  createUMDPlugin: typeof createUMDPlugin;
  registerUMDPlugin: typeof registerUMDPlugin;
};

export default _default;
`;

    writeFileSync(join(outDir, 'naap-plugin-sdk.d.ts'), dtsContent);
    console.log('✓ Created naap-plugin-sdk.d.ts');

    console.log('\nUMD build complete!');
    console.log(`Output directory: ${outDir}`);

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
