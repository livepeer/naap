/**
 * Plugin Loader
 *
 * Handles dynamic loading of plugin bundles from CDN with caching,
 * retry logic, and error handling.
 */

export interface PluginModule {
  mount: (container: HTMLElement, context: unknown) => (() => void) | void;
  init?: () => Promise<void>;
  unmount?: () => void;
}

export interface LoadPluginOptions {
  url: string;
  name: string;
  timeout?: number;
  retries?: number;
  onProgress?: (progress: number) => void;
}

export interface LoadedPlugin {
  name: string;
  module: PluginModule;
  url: string;
  loadedAt: Date;
}

// Security: Allowed plugin hosts
const ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  'naap.dev',
  'vercel.app',
  'blob.vercel-storage.com',
];

// Module cache for loaded plugins
const moduleCache = new Map<string, LoadedPlugin>();

/**
 * Validate plugin URL security
 */
function validatePluginUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    const isAllowed = ALLOWED_HOSTS.some(
      host => hostname === host || hostname.endsWith('.' + host)
    );

    if (!isAllowed && process.env.NODE_ENV === 'production') {
      throw new Error(`Plugin URL not in allowed hosts: ${hostname}`);
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Invalid plugin URL: ${url}`);
    }
    throw err;
  }
}

/**
 * Load a plugin module with retry logic
 */
export async function loadPlugin(options: LoadPluginOptions): Promise<LoadedPlugin> {
  const { url, name, timeout = 30000, retries = 3, onProgress } = options;

  // Check cache
  const cached = moduleCache.get(url);
  if (cached) {
    return cached;
  }

  // Validate URL security
  validatePluginUrl(url);

  let lastError: Error | null = null;
  let attempts = 0;

  while (attempts < retries) {
    try {
      attempts++;
      onProgress?.(attempts / retries * 0.5);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        // Dynamic import with timeout
        const pluginModule = await Promise.race([
          importPluginModule(url),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Plugin load timeout')), timeout)
          ),
        ]);

        clearTimeout(timeoutId);

        // Validate module structure
        if (!pluginModule || typeof pluginModule.mount !== 'function') {
          throw new Error('Invalid plugin module - missing mount function');
        }

        onProgress?.(1);

        const loadedPlugin: LoadedPlugin = {
          name,
          module: pluginModule,
          url,
          loadedAt: new Date(),
        };

        // Cache the loaded module
        moduleCache.set(url, loadedPlugin);

        return loadedPlugin;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Plugin load attempt ${attempts} failed:`, lastError.message);

      if (attempts < retries) {
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
  }

  throw new Error(`Failed to load plugin ${name} after ${retries} attempts: ${lastError?.message}`);
}

/**
 * Import plugin module using dynamic import
 */
async function importPluginModule(url: string): Promise<PluginModule> {
  // Use Function constructor to avoid bundler issues with dynamic imports
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imported = await (Function('url', 'return import(url)')(url) as Promise<any>);

  // Handle both default and named exports
  return imported.default || imported;
}

/**
 * Preload a plugin without mounting
 */
export async function preloadPlugin(url: string, name: string): Promise<void> {
  if (moduleCache.has(url)) return;

  try {
    await loadPlugin({ url, name, retries: 1, timeout: 10000 });
  } catch {
    // Preload failures are non-critical
    console.warn(`Preload failed for plugin ${name}`);
  }
}

/**
 * Clear plugin from in-memory module cache
 */
export function clearModuleCache(url?: string): void {
  if (url) {
    moduleCache.delete(url);
  } else {
    moduleCache.clear();
  }
}

/**
 * Get all cached plugins
 */
export function getCachedPlugins(): LoadedPlugin[] {
  return Array.from(moduleCache.values());
}

/**
 * Check if plugin is cached
 */
export function isPluginCached(url: string): boolean {
  return moduleCache.has(url);
}

/**
 * Plugin mount helper with error boundary
 */
export function mountPlugin(
  plugin: LoadedPlugin,
  container: HTMLElement,
  context: unknown
): () => void {
  let cleanup: (() => void) | void;

  try {
    cleanup = plugin.module.mount(container, context);
  } catch (err) {
    console.error(`Plugin ${plugin.name} mount error:`, err);
    container.innerHTML = `
      <div class="plugin-error">
        <h3>Plugin Error</h3>
        <p>${err instanceof Error ? err.message : 'Failed to mount plugin'}</p>
      </div>
    `;
    return () => {};
  }

  return () => {
    try {
      if (typeof cleanup === 'function') {
        cleanup();
      } else if (plugin.module.unmount) {
        plugin.module.unmount();
      }
    } catch (err) {
      console.error(`Plugin ${plugin.name} unmount error:`, err);
    }
  };
}

/**
 * Initialize plugin if it has an init function
 */
export async function initializePlugin(plugin: LoadedPlugin): Promise<void> {
  if (plugin.module.init) {
    try {
      await plugin.module.init();
    } catch (err) {
      console.error(`Plugin ${plugin.name} init error:`, err);
      throw new Error(`Plugin initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}
