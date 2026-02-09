/**
 * UMD Plugin Mount Template
 *
 * This template creates a UMD-compatible plugin entry point.
 * Copy this to your plugin's frontend/src directory as `mount.tsx`
 * and update the imports and configuration.
 *
 * The plugin will be exposed as a global variable (e.g., window.NaapPluginMyPlugin)
 * with a `mount` function that the shell calls to render the plugin.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
// Import your main App component
import App from './App';
// Optional: Import your app-specific providers
// import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================
// Plugin Configuration
// ============================================

const PLUGIN_NAME = 'your-plugin-name'; // e.g., 'capacity-planner'
const PLUGIN_VERSION = '1.0.0';

// ============================================
// Shell Context Types
// ============================================

interface ShellContext {
  auth: {
    getUser: () => { id: string; displayName?: string } | null;
    getToken: () => string | null;
    isAuthenticated: () => boolean;
  };
  notifications: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
  navigate: (path: string) => void;
  eventBus: {
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (data: unknown) => void) => () => void;
  };
  theme: {
    mode: 'light' | 'dark';
  };
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  permissions: {
    can: (resource: string, action: string) => boolean;
  };
  shellVersion?: string;
  pluginBasePath?: string;
}

// ============================================
// Internal State
// ============================================

let currentRoot: ReturnType<typeof ReactDOM.createRoot> | null = null;
let currentContext: ShellContext | null = null;

// Optional: Create QueryClient outside of component for persistence
// const queryClient = new QueryClient({
//   defaultOptions: {
//     queries: { staleTime: 5 * 60 * 1000 },
//   },
// });

// ============================================
// Shell Context Provider
// ============================================

const ShellContextReact = React.createContext<ShellContext | null>(null);

export function useShellContext(): ShellContext {
  const context = React.useContext(ShellContextReact);
  if (!context) {
    throw new Error('useShellContext must be used within ShellContextProvider');
  }
  return context;
}

// ============================================
// Plugin Mount Function
// ============================================

/**
 * Mounts the plugin to a container element.
 * Called by the shell to render the plugin.
 *
 * @param container - The DOM element to mount to
 * @param context - Shell context with services
 * @returns Cleanup function to unmount
 */
export function mount(container: HTMLElement, context: ShellContext): () => void {
  currentContext = context;

  // Create React root
  currentRoot = ReactDOM.createRoot(container);

  // Build component tree
  const content = (
    <ShellContextReact.Provider value={context}>
      {/* Optional: Wrap with QueryClientProvider if using React Query */}
      {/* <QueryClientProvider client={queryClient}> */}
      <App context={context} />
      {/* </QueryClientProvider> */}
    </ShellContextReact.Provider>
  );

  currentRoot.render(content);

  // Log mount for debugging
  context.logger?.info?.(`[${PLUGIN_NAME}] Plugin mounted`);

  // Return cleanup function
  return () => {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    currentContext = null;
    context.logger?.info?.(`[${PLUGIN_NAME}] Plugin unmounted`);
  };
}

/**
 * Unmounts the plugin.
 * Alternative cleanup method.
 */
export function unmount(): void {
  if (currentRoot) {
    currentRoot.unmount();
    currentRoot = null;
  }
  currentContext = null;
}

/**
 * Gets the current shell context.
 * Useful for accessing shell services outside React components.
 */
export function getContext(): ShellContext | null {
  return currentContext;
}

// ============================================
// Plugin Metadata
// ============================================

export const metadata = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
};

// ============================================
// UMD Global Registration
// ============================================

// This registers the plugin on the window object for UMD loading
if (typeof window !== 'undefined') {
  const globalName = `NaapPlugin${PLUGIN_NAME
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')}`;

  (window as unknown as Record<string, unknown>)[globalName] = {
    mount,
    unmount,
    getContext,
    metadata,
  };
}

// Default export for ESM compatibility
export default { mount, unmount, getContext, metadata };
