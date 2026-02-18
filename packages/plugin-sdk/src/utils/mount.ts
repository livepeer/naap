/**
 * Plugin Mount Helper
 *
 * Provides a standardized way to mount React-based plugins with minimal boilerplate.
 * Handles the common pattern of:
 * - Creating a React root
 * - Wrapping with ShellProvider
 * - Managing cleanup on unmount
 *
 * For UMD builds, use createUMDPluginMount from '@naap/plugin-sdk/umd' instead.
 */

import { type ComponentType, type ReactNode, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import type { ShellContext } from '../types/context.js';
import type { PluginMountFn, PluginModule } from '../types/context.js';
import { ShellProvider } from '../hooks/useShell.js';
import { validateShellContext, formatPluginError } from './contract-validation.js';

/**
 * Options for creating a plugin mount function
 */
export interface CreatePluginMountOptions {
  /**
   * The root React component for the plugin
   */
  App: ComponentType<{ context?: ShellContext }>;

  /**
   * Optional wrapper component (e.g., for additional providers like React Query)
   */
  wrapper?: ComponentType<{ children: ReactNode; context: ShellContext }>;

  /**
   * Optional async initialization function.
   * Called before mount() by the shell. Use for:
   * - Loading plugin configuration
   * - Establishing connections
   * - Pre-fetching critical data
   */
  onInit?: (context: ShellContext) => void | Promise<void>;

  /**
   * Optional callback when plugin is mounted
   */
  onMount?: (context: ShellContext) => void;

  /**
   * Optional callback when plugin is unmounted
   */
  onUnmount?: () => void;

  /**
   * Optional error boundary component
   */
  ErrorBoundary?: ComponentType<{ children: ReactNode }>;
}

/**
 * Plugin manifest metadata
 */
export interface PluginMetadata {
  name: string;
  version: string;
  routes: string[];
}

/**
 * Creates a standardized mount function for React-based plugins.
 * 
 * This reduces the boilerplate required in each plugin's entry point
 * from ~20 lines to just a few lines.
 * 
 * @example
 * ```tsx
 * // Before (verbose)
 * export function mount(container: HTMLElement, context: ShellContext) {
 *   shellContext = context;
 *   const root = ReactDOM.createRoot(container);
 *   root.render(
 *     <ShellProvider value={context}>
 *       <App />
 *     </ShellProvider>
 *   );
 *   return () => { root.unmount(); shellContext = null; };
 * }
 * 
 * // After (concise)
 * export const { mount, unmount } = createPluginMount({ App });
 * ```
 */
export function createPluginMount(options: CreatePluginMountOptions): {
  init?: (context: ShellContext) => void | Promise<void>;
  mount: PluginMountFn;
  unmount: () => void;
  getContext: () => ShellContext | null;
} {
  const { App, wrapper: Wrapper, onInit, onMount, onUnmount, ErrorBoundary } = options;

  // Store context for plugins that need to access it outside React
  let shellContext: ShellContext | null = null;
  // React root with render and unmount methods
  let root: { render: (children: ReactNode) => void; unmount: () => void } | null = null;
  // Track which container has a root to avoid duplicate createRoot calls
  let currentContainer: HTMLElement | null = null;

  // Optional init function (called by shell before mount)
  const init = onInit ? async (context: ShellContext) => {
    shellContext = context;
    await onInit(context);
  } : undefined;

  // Track mount generation to prevent stale deferred unmounts
  let mountGeneration = 0;

  // Build the React element tree for rendering
  function buildContent(context: ShellContext): ReactNode {
    let content: ReactNode = createElement(App, { context });

    if (Wrapper) {
      content = createElement(Wrapper, { context, children: content });
    }

    content = createElement(ShellProvider, { value: context, children: content });

    if (ErrorBoundary) {
      content = createElement(ErrorBoundary, null, content);
    }

    return content;
  }

  const mount: PluginMountFn = (container: HTMLElement, context: ShellContext) => {
    // Runtime context validation — emit warnings in development, never throw
    if (process.env.NODE_ENV !== 'production') {
      const ctxResult = validateShellContext(context);
      if (!ctxResult.valid || ctxResult.warnings.length > 0) {
        const pluginName = (options as unknown as Record<string, unknown>).name as string || 'unknown';
        console.warn(formatPluginError(pluginName, 'mount', ctxResult));
      }
    }

    shellContext = context;
    mountGeneration++;
    const gen = mountGeneration;

    // Expose shell context on window so non-React code (e.g., api.ts modules
    // that use authHeaders()) can access auth tokens and config.
    // This is critical for UMD-mounted plugins where main.tsx is not executed.
    if (typeof window !== 'undefined') {
      (window as any).__SHELL_CONTEXT__ = context;
    }

    // Reuse existing root if mounting into the same container (React StrictMode
    // remount). Calling createRoot() twice on the same container causes a warning.
    if (root && currentContainer === container) {
      root.render(buildContent(context));
    } else {
      // Different container or first mount -- create a new root
      const newRoot = ReactDOM.createRoot(container);
      root = newRoot;
      currentContainer = container;
      newRoot.render(buildContent(context));
    }

    if (onMount) {
      onMount(context);
    }

    // Return cleanup function.
    // Defer root.unmount() to next microtask to avoid "synchronously unmount
    // while React was already rendering" warning in StrictMode.
    return () => {
      if (onUnmount) {
        onUnmount();
      }
      shellContext = null;
      // Don't null out root/container here -- if StrictMode remounts into the
      // same container before the microtask fires, we need to detect and reuse it.
      const rootToUnmount = root;
      const containerToClean = currentContainer;
      if (rootToUnmount) {
        queueMicrotask(() => {
          // Only unmount if no new mount happened since this cleanup was scheduled
          if (mountGeneration === gen) {
            rootToUnmount.unmount();
            root = null;
            currentContainer = null;
          }
        });
      }
    };
  };

  const unmount = () => {
    if (onUnmount) {
      onUnmount();
    }
    const rootToUnmount = root;
    root = null;
    currentContainer = null;
    shellContext = null;
    if (rootToUnmount) {
      queueMicrotask(() => {
        rootToUnmount.unmount();
      });
    }
  };

  const getContext = () => shellContext;

  return { init, mount, unmount, getContext };
}

/**
 * Creates a complete plugin manifest with standardized mount/unmount.
 * 
 * @example
 * ```tsx
 * // Simple usage
 * export const manifest = createPlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   routes: ['/my-plugin', '/my-plugin/*'],
 *   App: MyPluginApp,
 * });
 * 
 * // With additional providers
 * export const manifest = createPlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   routes: ['/my-plugin'],
 *   App: MyPluginApp,
 *   wrapper: ({ children, context }) => (
 *     <QueryClientProvider client={queryClient}>
 *       {children}
 *     </QueryClientProvider>
 *   ),
 * });
 * ```
 */
export function createPlugin(
  options: CreatePluginMountOptions & PluginMetadata
): PluginModule & PluginMetadata {
  const { name, version, routes, ...mountOptions } = options;

  // Runtime contract validation at construction time
  if (typeof mountOptions.App !== 'function') {
    const got = mountOptions.App === null ? 'null' : typeof mountOptions.App;
    throw new Error(
      `[NAAP Plugin "${name}"] App must be a React component (function), got: ${got}.` +
      `\n  → Pass your root component: createPlugin({ ..., App: MyApp })`
    );
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `[NAAP Plugin] name must be a non-empty string.` +
      `\n  → Example: createPlugin({ name: 'my-plugin', ... })`
    );
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(
      `[NAAP Plugin "${name}"] version must be a non-empty string.` +
      `\n  → Example: createPlugin({ ..., version: '1.0.0' })`
    );
  }

  const { init, mount, unmount, getContext } = createPluginMount(mountOptions);

  return {
    name,
    version,
    routes,
    init,
    mount,
    unmount,
    metadata: { name, version },
    // Expose getContext for plugins that need shell access outside React
    getContext,
  } as PluginModule & PluginMetadata & { getContext: () => ShellContext | null };
}

/**
 * Type helper for defining plugin manifest
 */
export type PluginManifestExport = PluginModule & PluginMetadata;

// ============================================
// Phase 6e: HMR Support for Plugin Development
// ============================================

/**
 * Enable Vite HMR for a plugin created with createPlugin or createPluginMount.
 * 
 * Call this in your plugin's main entry point (e.g., App.tsx or main.tsx)
 * to enable hot module replacement during development. Changes will be
 * applied without a full page reload.
 * 
 * @param hot - Vite's `import.meta.hot` object
 * @param plugin - The plugin module returned by createPlugin/createPluginMount
 * 
 * @example
 * ```tsx
 * // In your plugin entry (App.tsx)
 * import { createPlugin, enablePluginHMR } from '@naap/plugin-sdk';
 * 
 * const plugin = createPlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   routes: ['/my-plugin'],
 *   App: MyApp,
 * });
 * 
 * // Enable HMR in development
 * if (import.meta.hot) {
 *   enablePluginHMR(import.meta.hot, plugin);
 * }
 * 
 * export default plugin;
 * ```
 */
export function enablePluginHMR(
  hot: {
    accept: (callback?: (mod: unknown) => void) => void;
    dispose: (callback: () => void) => void;
    data?: Record<string, unknown>;
  },
  plugin: { mount: PluginMountFn; unmount?: () => void; getContext?: () => ShellContext | null }
): void {
  // Store the current context and container in HMR data so they survive module replacement
  hot.dispose(() => {
    // Save current state for the next module instance
    const context = plugin.getContext?.();
    if (context) {
      hot.data = hot.data || {};
      hot.data.__hmrContext = context;
      // Find and save the container element
      hot.data.__hmrContainerId = `plugin-hmr-${Date.now()}`;
    }

    // Unmount the current instance
    if (plugin.unmount) {
      plugin.unmount();
    }
  });

  hot.accept((newModule: unknown) => {
    if (!newModule) return;

    const mod = newModule as Record<string, unknown>;
    const newPlugin = (mod.default || mod.manifest || mod) as {
      mount?: PluginMountFn;
      getContext?: () => ShellContext | null;
    };

    if (!newPlugin.mount || typeof newPlugin.mount !== 'function') {
      console.warn('[HMR] New module does not export a valid plugin mount function');
      return;
    }

    // Recover saved context and container
    const savedContext = hot.data?.__hmrContext as ShellContext | undefined;
    if (savedContext) {
      // Find the plugin's container in the DOM
      // The shell renders plugins into containers with known class names
      const containers = document.querySelectorAll<HTMLElement>('[data-plugin-container]');
      const container = containers.length > 0 ? containers[containers.length - 1] : null;

      if (container) {
        console.log('[HMR] Re-mounting plugin with saved context');
        newPlugin.mount(container, savedContext);
      } else {
        console.warn('[HMR] Could not find plugin container for re-mount. Try a full reload.');
      }
    }
  });
}
