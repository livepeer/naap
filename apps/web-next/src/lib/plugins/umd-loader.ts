/**
 * UMD Plugin Loader
 *
 * Loads UMD plugin bundles via script tag injection.
 * Designed for CDN-deployed plugins that are exposed as globals.
 *
 * IMPORTANT: UMD bundles expect React and ReactDOM on the window object.
 * This loader ensures they are available before loading any plugin.
 *
 * UMD bundles externalize 'react/jsx-runtime' and map it to 'React' global.
 * This means window.React MUST have jsx, jsxs, jsxDEV, and Fragment functions.
 */

import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMAll from 'react-dom';
// Import both jsx-runtime (production) and jsx-dev-runtime (development)
// UMD bundles may use either depending on build mode
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
let jsxDEV: typeof jsx | undefined;
try {
  // jsx-dev-runtime may not be available in all environments
  // Use dynamic require to avoid build errors
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const devRuntime = require('react/jsx-dev-runtime');
  jsxDEV = devRuntime.jsxDEV;
} catch {
  // Development runtime not available, use production jsx as fallback
  jsxDEV = jsx;
}

/**
 * Creates a merged React object with jsx-runtime functions attached.
 * UMD bundles map 'react/jsx-runtime' to 'React' global, so we need
 * jsx, jsxs, jsxDEV, and Fragment on the React object.
 *
 * IMPORTANT: We use explicit property assignment instead of spread because:
 * 1. Module exports may have non-enumerable properties
 * 2. Spread may not work correctly with ES module namespaces
 * 3. Explicit assignment is more debuggable
 */
function createMergedReact(): typeof React & {
  jsx: typeof jsx;
  jsxs: typeof jsxs;
  jsxDEV: typeof jsx;
  Fragment: typeof Fragment;
} {
  // Start with a copy of React's own exports
  const merged = Object.create(React);

  // Copy all enumerable properties from React
  Object.assign(merged, React);

  // Explicitly add jsx-runtime functions
  // These MUST be present for UMD bundles that externalize react/jsx-runtime
  merged.jsx = jsx;
  merged.jsxs = jsxs;
  merged.jsxDEV = jsxDEV || jsx; // Fallback to jsx if jsxDEV unavailable
  merged.Fragment = Fragment;

  return merged;
}

/**
 * Creates a merged ReactDOM object with react-dom/client exports.
 * UMD bundles may import from 'react-dom' or 'react-dom/client'.
 */
function createMergedReactDOM(): typeof ReactDOMAll & typeof ReactDOMClient {
  const merged = { ...ReactDOMAll, ...ReactDOMClient };
  return merged;
}

/**
 * Ensures React and ReactDOM are properly exposed on window for UMD bundles.
 * This function is idempotent and safe to call multiple times.
 *
 * Returns true if globals were set up successfully.
 */
function ensureReactGlobals(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const win = window as unknown as Record<string, unknown>;

  // Create merged React with jsx-runtime functions
  const mergedReact = createMergedReact();
  const mergedReactDOM = createMergedReactDOM();

  // Set globals
  win.React = mergedReact;
  win.ReactDOM = mergedReactDOM;

  // Verify jsx functions are present
  const hasJsx = typeof (win.React as Record<string, unknown>)?.jsx === 'function';
  const hasJsxs = typeof (win.React as Record<string, unknown>)?.jsxs === 'function';
  const hasFragment = typeof (win.React as Record<string, unknown>)?.Fragment !== 'undefined';
  const hasCreateRoot = typeof (win.ReactDOM as Record<string, unknown>)?.createRoot === 'function';

  if (!hasJsx || !hasJsxs) {
    console.error('[UMD Loader] CRITICAL: jsx/jsxs functions not properly attached to window.React');
    console.error('[UMD Loader] jsx:', typeof (win.React as Record<string, unknown>)?.jsx);
    console.error('[UMD Loader] jsxs:', typeof (win.React as Record<string, unknown>)?.jsxs);
    return false;
  }

  console.log('[UMD Loader] React globals exposed successfully:', {
    React: typeof win.React,
    'React.jsx': hasJsx ? 'function' : 'MISSING',
    'React.jsxs': hasJsxs ? 'function' : 'MISSING',
    'React.Fragment': hasFragment ? 'present' : 'MISSING',
    'React.version': (win.React as { version?: string })?.version,
    'ReactDOM.createRoot': hasCreateRoot ? 'function' : 'MISSING',
  });

  return true;
}

// Initialize React globals immediately when this module loads
const globalsInitialized = ensureReactGlobals();

/**
 * UMD Plugin Module interface
 */
export interface UMDPluginModule {
  mount: (container: HTMLElement, context: unknown) => (() => void) | void;
  unmount?: () => void;
  metadata?: {
    name: string;
    version: string;
  };
}

/**
 * UMD Plugin factory function
 * Some plugins export a factory that receives React instances
 */
export type UMDPluginFactory = (
  react: typeof React,
  reactDOM: typeof ReactDOMClient
) => UMDPluginModule;

/**
 * Options for loading a UMD plugin
 */
export interface UMDLoadOptions {
  /** Plugin name (used as global variable name) */
  name: string;

  /** CDN URL for the bundle */
  bundleUrl: string;

  /** CDN URL for styles (optional) */
  stylesUrl?: string;

  /** Global name for the UMD module (e.g., NaapPluginMyPlugin) */
  globalName: string;

  /** Expected content hash for validation */
  bundleHash?: string;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Progress callback */
  onProgress?: (progress: number) => void;
}

/**
 * Loaded UMD plugin result
 */
export interface LoadedUMDPlugin {
  name: string;
  module: UMDPluginModule;
  bundleUrl: string;
  stylesUrl?: string;
  globalName: string;
  loadedAt: Date;
}

// Security: Allowed plugin CDN hosts
const ALLOWED_CDN_HOSTS = [
  'localhost',
  '127.0.0.1',
  'blob.vercel-storage.com',
  'cdn.naap.io',
  'naap.dev',
  'vercel.app',
];

// Cache for loaded UMD plugins
const umdModuleCache = new Map<string, LoadedUMDPlugin>();

// Track script loading promises to avoid duplicate loads
const loadingPromises = new Map<string, Promise<LoadedUMDPlugin>>();

/**
 * Validates CDN URL security
 */
function validateCDNUrl(url: string): void {
  // Relative URLs (same-origin) are always safe — they resolve to the
  // current deployment origin, so no cross-origin or protocol concerns.
  if (url.startsWith('/')) {
    return;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Check protocol
    if (parsed.protocol !== 'https:' && !hostname.includes('localhost') && hostname !== '127.0.0.1') {
      throw new Error(`Plugin must be loaded over HTTPS: ${url}`);
    }

    // Check allowed hosts
    const isAllowed = ALLOWED_CDN_HOSTS.some(
      host => hostname === host || hostname.endsWith('.' + host)
    );

    if (!isAllowed && process.env.NODE_ENV === 'production') {
      throw new Error(`Plugin URL not in allowed CDN hosts: ${hostname}`);
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Invalid plugin URL: ${url}`);
    }
    throw err;
  }
}

/**
 * Loads a script and returns when it's executed
 */
function loadScript(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if script is already loaded
    const existingScript = document.querySelector(`script[src="${url}"]`);
    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.type = 'text/javascript';
    script.crossOrigin = 'anonymous';

    const timeoutId = setTimeout(() => {
      script.remove();
      reject(new Error(`Script load timeout: ${url}`));
    }, timeout);

    // Capture any execution errors from this script
    let scriptError: Error | null = null;
    const errorHandler = (event: ErrorEvent) => {
      // Check if the error is from this script
      if (event.filename && event.filename.includes(url.split('/').pop() || '')) {
        scriptError = new Error(`Script execution error: ${event.message} at ${event.filename}:${event.lineno}`);
        console.error('[UMD Loader] Script execution error:', event.message, event.filename, event.lineno);
      }
    };
    window.addEventListener('error', errorHandler);

    script.onload = () => {
      clearTimeout(timeoutId);
      // Small delay to allow error events to fire
      setTimeout(() => {
        window.removeEventListener('error', errorHandler);
        if (scriptError) {
          reject(scriptError);
        } else {
          resolve();
        }
      }, 10);
    };

    script.onerror = (_event) => {
      clearTimeout(timeoutId);
      window.removeEventListener('error', errorHandler);
      script.remove();
      reject(new Error(`Failed to load script: ${url}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Loads a stylesheet
 */
function loadStylesheet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if stylesheet is already loaded
    const existingLink = document.querySelector(`link[href="${url}"]`);
    if (existingLink) {
      resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = url;
    link.crossOrigin = 'anonymous';

    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${url}`));

    document.head.appendChild(link);
  });
}

/**
 * Retrieves the UMD module from the global scope
 */
function getGlobalModule(globalName: string): UMDPluginModule | UMDPluginFactory | undefined {
  const win = window as unknown as Record<string, unknown>;

  // Try the exact global name first
  if (win[globalName]) {
    return win[globalName] as UMDPluginModule | UMDPluginFactory;
  }

  // Try the factory pattern (__naap_plugin_xxx)
  const factoryKey = `__naap_plugin_${globalName.replace(/^NaapPlugin/, '').toLowerCase()}`;
  if (win[factoryKey]) {
    return win[factoryKey] as UMDPluginFactory;
  }

  // Try common variations
  const variations = [
    globalName,
    globalName.replace(/Plugin$/, ''),
    `naap_plugin_${globalName.replace(/^NaapPlugin/, '').toLowerCase()}`,
  ];

  for (const name of variations) {
    if (win[name]) {
      return win[name] as UMDPluginModule | UMDPluginFactory;
    }
  }

  return undefined;
}

/**
 * Waits for a global variable to be defined with exponential backoff
 * More reliable than fixed timeout
 */
async function waitForGlobal(
  globalName: string,
  maxWaitMs: number = 5000
): Promise<UMDPluginModule | UMDPluginFactory | undefined> {
  const startTime = Date.now();
  let delay = 10; // Start with 10ms
  const maxDelay = 200; // Max 200ms between checks

  while (Date.now() - startTime < maxWaitMs) {
    const foundModule = getGlobalModule(globalName);
    if (foundModule) {
      return foundModule;
    }

    // Exponential backoff: 10, 20, 40, 80, 160, 200, 200...
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, maxDelay);
  }

  return undefined;
}

/**
 * Loads a UMD plugin from CDN
 */
export async function loadUMDPlugin(options: UMDLoadOptions): Promise<LoadedUMDPlugin> {
  const {
    name,
    bundleUrl,
    stylesUrl,
    globalName,
    timeout = 30000,
    onProgress,
  } = options;

  console.log(`[UMD Loader] loadUMDPlugin called for ${name}`, { bundleUrl, globalName });

  // Ensure React globals are properly set up with jsx-runtime functions
  // This is critical - UMD bundles map 'react/jsx-runtime' to the 'React' global
  if (!globalsInitialized) {
    console.warn('[UMD Loader] React globals were not initialized at module load, attempting now');
    const success = ensureReactGlobals();
    if (!success) {
      throw new Error('Failed to initialize React globals for UMD plugin loading');
    }
  }

  // Verify jsx functions are available (critical for UMD bundles)
  if (typeof window !== 'undefined') {
    const win = window as unknown as Record<string, unknown>;
    const reactGlobal = win.React as Record<string, unknown>;
    if (typeof reactGlobal?.jsx !== 'function') {
      console.warn('[UMD Loader] window.React.jsx missing, re-initializing globals');
      ensureReactGlobals();
    }
  }

  // Check cache FIRST (synchronous)
  const cached = umdModuleCache.get(bundleUrl);
  if (cached) {
    console.log(`[UMD Loader] ${name}: Returning from cache`);
    onProgress?.(1);
    return cached;
  }

  // Check if already loading (synchronous check before creating new promise)
  const existingPromise = loadingPromises.get(bundleUrl);
  if (existingPromise) {
    console.log(`[UMD Loader] ${name}: Returning existing loading promise`);
    return existingPromise;
  }

  // Validate URLs (synchronous)
  validateCDNUrl(bundleUrl);
  if (stylesUrl) {
    validateCDNUrl(stylesUrl);
  }

  // Create loading promise and add to map SYNCHRONOUSLY to prevent race conditions
  // This ensures no other call can slip in between check and set
  let resolveLoading: (value: LoadedUMDPlugin) => void;
  let rejectLoading: (reason: Error) => void;
  const loadPromise = new Promise<LoadedUMDPlugin>((resolve, reject) => {
    resolveLoading = resolve;
    rejectLoading = reject;
  });

  // Set the promise BEFORE any async work
  loadingPromises.set(bundleUrl, loadPromise);

  // Now do the async loading
  (async (): Promise<void> => {
    try {
      onProgress?.(0.1);

      // Load styles first (non-blocking)
      if (stylesUrl) {
        loadStylesheet(stylesUrl).catch(err => {
          console.warn(`Failed to load plugin styles: ${err.message}`);
        });
      }

      onProgress?.(0.3);

      // Verify React and jsx-runtime are available on window before loading plugin
      const winCheck = window as unknown as Record<string, unknown>;
      const reactCheck = winCheck.React as Record<string, unknown>;
      const reactDOMCheck = winCheck.ReactDOM as Record<string, unknown>;

      // Critical jsx-runtime checks - these MUST be present for UMD bundles
      const jsxCheck = typeof reactCheck?.jsx;
      const jsxsCheck = typeof reactCheck?.jsxs;

      console.log(`[UMD Loader] Pre-load check:`, {
        'window.React': typeof winCheck.React,
        'React.version': (reactCheck as { version?: string })?.version,
        'React.jsx': jsxCheck,
        'React.jsxs': jsxsCheck,
        'React.jsxDEV': typeof reactCheck?.jsxDEV,
        'React.Fragment': typeof reactCheck?.Fragment,
        'ReactDOM': typeof winCheck.ReactDOM,
        'ReactDOM.createRoot': typeof reactDOMCheck?.createRoot,
      });

      // Fail fast if jsx functions are missing - this will cause plugin execution errors
      if (jsxCheck !== 'function' || jsxsCheck !== 'function') {
        console.error('[UMD Loader] CRITICAL: jsx/jsxs functions missing from window.React!');
        console.error('[UMD Loader] UMD bundles externalize react/jsx-runtime -> React global');
        console.error('[UMD Loader] Attempting to re-initialize globals...');
        ensureReactGlobals();

        // Re-check after initialization
        const recheck = (winCheck.React as Record<string, unknown>);
        if (typeof recheck?.jsx !== 'function') {
          throw new Error('Cannot load UMD plugin: window.React.jsx is not a function. JSX runtime failed to attach.');
        }
      }

      // Load the script
      console.log(`[UMD Loader] Loading script: ${bundleUrl}`);
      await loadScript(bundleUrl, timeout);

      onProgress?.(0.7);

      // Get the module from global scope with proper waiting
      console.log(`[UMD Loader] Script loaded, waiting for global: ${globalName}`);
      const rawModule = await waitForGlobal(globalName, 5000);

      if (!rawModule) {
        // Log available globals for debugging
        const availableGlobals = Object.keys(window)
          .filter(k => k.toLowerCase().includes('naap') || k.toLowerCase().includes('plugin'))
          .slice(0, 10);
        console.error(`[UMD Loader] Available plugin-related globals:`, availableGlobals);
        throw new Error(`Plugin global '${globalName}' not found after script load. Available: ${availableGlobals.join(', ')}`);
      }

      console.log(`[UMD Loader] Found global ${globalName}:`, typeof rawModule);

      // Debug: log module structure
      if (rawModule && typeof rawModule === 'object') {
        const keys = Object.keys(rawModule as object);
        console.log(`[UMD Loader] Module keys:`, keys.slice(0, 10));
      }

      // If it's a factory function, call it with React (with jsx-runtime functions)
      let pluginModule: UMDPluginModule;
      if (typeof rawModule === 'function') {
        // It's a factory - call it with React instances
        // Pass merged React (with jsx-runtime) and merged ReactDOM (with createRoot)
        const mergedReact = createMergedReact();
        const mergedReactDOM = createMergedReactDOM();
        pluginModule = (rawModule as UMDPluginFactory)(mergedReact, mergedReactDOM);
      } else {
        pluginModule = rawModule as UMDPluginModule;
      }

      // Validate module structure with actionable error messages
      if (!pluginModule || typeof pluginModule !== 'object') {
        const got = pluginModule === null ? 'null' : typeof pluginModule;
        console.error(
          `[NAAP Plugin Error] Plugin "${name}" failed during load:\n` +
          `  ✗ Plugin module is ${got}, expected an object with a mount() function.\n` +
          `  → Did the script fail to execute? Check browser console for errors from: ${bundleUrl}\n` +
          `\n  Quick fix — use createPlugin() in your App.tsx:\n` +
          `    import { createPlugin } from '@naap/plugin-sdk';\n` +
          `    const plugin = createPlugin({ name: '${name}', version: '1.0.0', App: MyApp });\n` +
          `    export default plugin;`
        );
        throw new Error(`Plugin "${name}" module is ${got}. Expected an object with mount(). Check console for details.`);
      }

      if (typeof pluginModule.mount !== 'function') {
        const moduleKeys = Object.keys(pluginModule);
        const mountType = 'mount' in pluginModule ? typeof pluginModule.mount : 'missing';
        console.error(
          `[NAAP Plugin Error] Plugin "${name}" failed during load:\n` +
          `  ✗ mount() is ${mountType === 'missing' ? 'missing' : `not a function (got: ${mountType})`}.\n` +
          `  → Module exports: [${moduleKeys.join(', ')}]\n` +
          `  → Did you forget to export { mount } from your mount.tsx?\n` +
          `\n  Quick fix — use createPlugin() in your App.tsx:\n` +
          `    import { createPlugin } from '@naap/plugin-sdk';\n` +
          `    const plugin = createPlugin({ name: '${name}', version: '1.0.0', App: MyApp });\n` +
          `    export default plugin;`
        );
        throw new Error(`Plugin "${name}" is missing mount(). Module has [${moduleKeys.join(', ')}]. Check console for fix instructions.`);
      }

      onProgress?.(1);

      const loadedPlugin: LoadedUMDPlugin = {
        name,
        module: pluginModule,
        bundleUrl,
        stylesUrl,
        globalName,
        loadedAt: new Date(),
      };

      // Cache the result
      umdModuleCache.set(bundleUrl, loadedPlugin);

      console.log(`[UMD Loader] ${name}: Successfully loaded and cached`);
      resolveLoading!(loadedPlugin);
    } catch (err) {
      console.error(`[UMD Loader] ${name}: Load failed`, err);
      rejectLoading!(err instanceof Error ? err : new Error(String(err)));
    } finally {
      loadingPromises.delete(bundleUrl);
    }
  })();

  return loadPromise;
}

/**
 * Preloads a UMD plugin without mounting
 */
export async function preloadUMDPlugin(options: Omit<UMDLoadOptions, 'onProgress'>): Promise<void> {
  if (umdModuleCache.has(options.bundleUrl)) return;

  try {
    await loadUMDPlugin({ ...options, timeout: 10000 });
  } catch {
    console.warn(`Preload failed for UMD plugin ${options.name}`);
  }
}

/**
 * Check if a UMD plugin is cached
 */
export function isUMDPluginCached(bundleUrl: string): boolean {
  return umdModuleCache.has(bundleUrl);
}

/**
 * Get a cached UMD plugin
 */
export function getCachedUMDPlugin(bundleUrl: string): LoadedUMDPlugin | undefined {
  return umdModuleCache.get(bundleUrl);
}

/**
 * Clear UMD plugin cache
 */
export function clearUMDPluginCache(bundleUrl?: string): void {
  if (bundleUrl) {
    umdModuleCache.delete(bundleUrl);
  } else {
    umdModuleCache.clear();
  }
}

/**
 * Get all cached UMD plugins
 */
export function getAllCachedUMDPlugins(): LoadedUMDPlugin[] {
  return Array.from(umdModuleCache.values());
}

/**
 * Escape HTML entities to prevent XSS when rendering error content.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Mount a UMD plugin with error handling
 */
export function mountUMDPlugin(
  plugin: LoadedUMDPlugin,
  container: HTMLElement | null,
  context: unknown
): () => void {
  if (!container) {
    console.error(
      `[NAAP Plugin Error] Plugin "${plugin.name}" failed during mount:\n` +
      `  ✗ Container element is null.\n` +
      `  → The shell must provide a valid DOM element for the plugin to render into.`
    );
    return () => {};
  }

  let cleanup: (() => void) | void;

  try {
    cleanup = plugin.module.mount(container, context);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[NAAP Plugin Error] Plugin "${plugin.name}" threw during mount():\n` +
      `  ✗ ${errMsg}\n` +
      `  → This usually means the plugin's React component tree failed to render.\n` +
      `  → Common causes: missing dependencies, undefined props, or import errors.`
    );
    container.innerHTML = `
      <div class="plugin-error p-4 bg-red-50 border border-red-200 rounded-lg">
        <h3 class="text-red-800 font-semibold">Plugin Error: ${escapeHtml(plugin.name)}</h3>
        <p class="text-red-600 text-sm mt-1">${escapeHtml(errMsg)}</p>
        <p class="text-red-400 text-xs mt-2">Check browser console for details.</p>
      </div>
    `;
    throw err;
  }

  return () => {
    try {
      if (typeof cleanup === 'function') {
        cleanup();
      } else if (plugin.module.unmount) {
        plugin.module.unmount();
      }
    } catch (err) {
      console.error(`UMD Plugin ${plugin.name} unmount error:`, err);
    }
  };
}
