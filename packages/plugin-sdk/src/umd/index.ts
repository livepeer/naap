/**
 * UMD Entry Point for Plugin SDK
 *
 * This module provides UMD-compatible exports for plugins that need to run
 * in environments where ES modules are not available (e.g., loaded via script tag).
 *
 * The UMD bundle will be exposed as window.NaapPluginSDK
 */

import type { ComponentType, ReactNode } from 'react';
import type { ShellContext } from '../types/context.js';
import type { PluginMountFn } from '../types/context.js';

// Re-export types
export type { ShellContext, PluginMountFn } from '../types/context.js';
export type {
  IAuthService,
  INotificationService,
  IEventBus,
  IThemeService,
  ILoggerService,
  IPermissionService,
  IIntegrationService,
  ICapabilityService,
} from '../types/services.js';

/**
 * Options for creating a UMD plugin mount function
 */
export interface UMDPluginMountOptions<P extends object = object> {
  /**
   * The root React component for the plugin.
   * Receives context as a prop.
   */
  App: ComponentType<{ context?: ShellContext } & P>;

  /**
   * Optional wrapper component for additional providers
   */
  wrapper?: ComponentType<{ children: ReactNode; context: ShellContext }>;

  /**
   * Optional async initialization function
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
 * Production manifest for CDN-deployed plugins
 */
export interface ProductionManifest {
  /** Plugin name (kebab-case) */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** Semantic version */
  version: string;

  /** CDN URL for the main bundle */
  bundleUrl: string;

  /** CDN URL for styles (optional) */
  stylesUrl?: string;

  /** Global variable name for UMD bundle */
  globalName: string;

  /** Content hash for cache validation */
  bundleHash: string;

  /** Bundle size in bytes */
  bundleSize: number;

  /** Routes this plugin handles */
  routes: string[];

  /** Plugin category */
  category?: string;

  /** Plugin description */
  description?: string;

  /** Plugin icon name */
  icon?: string;
}

/**
 * UMD Plugin Module interface
 */
export interface UMDPluginModule {
  /** Mount function to render the plugin */
  mount: PluginMountFn;

  /** Optional unmount function */
  unmount?: () => void;

  /** Plugin metadata */
  metadata?: {
    name: string;
    version: string;
  };
}

/**
 * Creates a UMD-compatible plugin mount function.
 *
 * This is designed for plugins that will be loaded via script tag
 * and exposed as a global variable.
 *
 * IMPORTANT: React and ReactDOM must be passed explicitly since they
 * are not bundled with the UMD build to avoid version conflicts.
 *
 * @param React - React library (passed from host)
 * @param ReactDOM - ReactDOM library (passed from host)
 * @param options - Plugin mount options
 * @returns Plugin module with mount/unmount functions
 *
 * @example
 * ```tsx
 * // In your plugin's UMD entry point
 * import { createUMDPluginMount } from '@naap/plugin-sdk/umd';
 * import App from './App';
 *
 * // The shell will call this with React instances
 * export function createPlugin(React, ReactDOM) {
 *   return createUMDPluginMount(React, ReactDOM, { App });
 * }
 * ```
 */
export function createUMDPluginMount(
  React: typeof import('react'),
  ReactDOM: typeof import('react-dom/client'),
  options: UMDPluginMountOptions
): UMDPluginModule {
  const { App, wrapper: Wrapper, onInit, onMount, onUnmount, ErrorBoundary } = options;

  let shellContext: ShellContext | null = null;
  let root: { render: (children: ReactNode) => void; unmount: () => void } | null = null;

  // Create ShellContext for React
  const ShellContextInstance = React.createContext<ShellContext | null>(null);

  // ShellProvider component
  interface ShellProviderProps {
    value: ShellContext;
    children: ReactNode;
  }

  const ShellProvider = ({ value, children }: ShellProviderProps) => {
    return React.createElement(ShellContextInstance.Provider, { value }, children);
  };

  const mount: PluginMountFn = (container: HTMLElement, context: ShellContext) => {
    shellContext = context;

    // Run init if provided
    if (onInit) {
      const initResult = onInit(context);
      if (initResult instanceof Promise) {
        // If init returns a promise, we need to wait for it
        // But mount is synchronous, so we'll handle errors
        initResult.catch((err) => {
          console.error('[Plugin] Init failed:', err);
        });
      }
    }

    const newRoot = ReactDOM.createRoot(container);
    root = newRoot;

    // Build the component tree
    let content: ReactNode = React.createElement(App, { context });

    // Wrap with custom wrapper if provided
    if (Wrapper) {
      content = React.createElement(Wrapper, { context, children: content });
    }

    // Wrap with ShellProvider
    content = React.createElement(ShellProvider, { value: context, children: content });

    // Wrap with ErrorBoundary if provided
    if (ErrorBoundary) {
      content = React.createElement(ErrorBoundary, null, content);
    }

    newRoot.render(content);

    // Call onMount callback
    if (onMount) {
      onMount(context);
    }

    // Return cleanup function
    return () => {
      if (onUnmount) {
        onUnmount();
      }
      if (root) {
        root.unmount();
        root = null;
      }
      shellContext = null;
    };
  };

  const unmount = () => {
    if (onUnmount) {
      onUnmount();
    }
    if (root) {
      root.unmount();
      root = null;
    }
    shellContext = null;
  };

  return { mount, unmount };
}

/**
 * Creates a complete UMD plugin with metadata.
 *
 * @param React - React library
 * @param ReactDOM - ReactDOM library
 * @param options - Plugin options including metadata
 * @returns Complete plugin module
 *
 * @example
 * ```tsx
 * export function createPlugin(React, ReactDOM) {
 *   return createUMDPlugin(React, ReactDOM, {
 *     name: 'my-plugin',
 *     version: '1.0.0',
 *     App: MyPluginApp,
 *   });
 * }
 * ```
 */
export function createUMDPlugin(
  React: typeof import('react'),
  ReactDOM: typeof import('react-dom/client'),
  options: UMDPluginMountOptions & { name: string; version: string }
): UMDPluginModule {
  const { name, version, ...mountOptions } = options;
  const plugin = createUMDPluginMount(React, ReactDOM, mountOptions);

  return {
    ...plugin,
    metadata: { name, version },
  };
}

/**
 * Hook to access shell context within UMD plugins.
 * This is a simplified version for UMD bundles.
 *
 * Must be called within a component tree that has ShellProvider.
 */
export function useShellContext(_React: typeof import('react')): ShellContext {
  // This is a placeholder - the actual context is created in createUMDPluginMount
  // Plugins should use the context passed to their App component
  throw new Error(
    'useShellContext cannot be used in UMD plugins. ' +
      'Use the context prop passed to your App component instead.'
  );
}

/**
 * Utility to register a UMD plugin globally.
 * This is called by the plugin's entry point to make it available to the shell.
 *
 * @param name - Plugin name (used as global variable)
 * @param createFn - Function that creates the plugin when called with React/ReactDOM
 *
 * @example
 * ```tsx
 * // In your plugin's entry point
 * registerUMDPlugin('myPlugin', (React, ReactDOM) => {
 *   return createUMDPluginMount(React, ReactDOM, { App });
 * });
 * ```
 */
export function registerUMDPlugin(
  name: string,
  createFn: (
    React: typeof import('react'),
    ReactDOM: typeof import('react-dom/client')
  ) => UMDPluginModule
): void {
  if (typeof window !== 'undefined') {
    // Store the factory function
    (window as unknown as Record<string, unknown>)[`__naap_plugin_${name}`] = createFn;

    // Also store the initialized plugin if React is already available
    const win = window as unknown as Record<string, unknown>;
    if (win.React && win.ReactDOM) {
      win[name] = createFn(
        win.React as typeof import('react'),
        win.ReactDOM as typeof import('react-dom/client')
      );
    }
  }
}

// Default export for convenience
export default {
  createUMDPluginMount,
  createUMDPlugin,
  registerUMDPlugin,
};
