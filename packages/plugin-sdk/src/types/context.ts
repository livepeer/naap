/**
 * Shell Context Types
 *
 * The ShellContext provides all services to plugins through a modern, typed interface.
 * This is the unified context that plugins receive in their mount() function.
 */

// Re-export ShellContext from services
export type { ShellContext } from './services.js';

// Import for use in this file
import type { ShellContext } from './services.js';

// ============================================
// Plugin Mount Types
// ============================================

/**
 * Mount function signature for plugins.
 * Receives the container element and shell context.
 */
export type PluginMountFn = (
  container: HTMLElement,
  context: ShellContext
) => PluginMountResult | (() => void) | void;

/**
 * Result from mounting a plugin.
 */
export interface PluginMountResult {
  /** Unmount function to clean up the plugin */
  unmount?: () => void;
}

/**
 * Plugin lifecycle phase
 */
export type PluginLifecyclePhase = 'idle' | 'initializing' | 'initialized' | 'mounting' | 'mounted' | 'unmounting' | 'error';

/**
 * Plugin initialization function.
 * Called before mount() to allow async setup (e.g., loading config, establishing connections).
 */
export type PluginInitFn = (context: ShellContext) => void | Promise<void>;

/**
 * Plugin module interface - what a plugin must export.
 * 
 * Lifecycle order:
 * 1. init(context) - Optional async initialization (config loading, connections)
 * 2. mount(container, context) - Render plugin UI
 * 3. unmount() - Cleanup on navigation away or plugin disable
 */
export interface PluginModule {
  /**
   * Optional initialization function.
   * Called once when the plugin is first loaded, before mount().
   * Use for async setup that must complete before rendering:
   * - Loading plugin configuration
   * - Establishing WebSocket connections
   * - Pre-fetching critical data
   * 
   * If init() rejects, mount() will not be called and an error will be shown.
   */
  init?: PluginInitFn;

  /** Mount function called when plugin is loaded */
  mount: PluginMountFn;

  /** Optional unmount function (alternative to returning from mount) */
  unmount?: () => void;

  /** Plugin metadata */
  metadata?: {
    name: string;
    version: string;
  };
}

// ============================================
// Legacy Types (Deprecated - For Reference Only)
// ============================================

/**
 * @deprecated Use ShellContext instead.
 */
export interface LegacyShellUser {
  id: string;
  walletAddress: string;
  displayName?: string;
  avatar?: string;
  roles?: string[];
}

/**
 * @deprecated Use ShellContext instead.
 */
export interface LegacyShellTheme {
  mode: 'light' | 'dark';
  primaryColor?: string;
  accentColor?: string;
}

/**
 * @deprecated Use ShellContext instead.
 */
export interface LegacyShellEventBus {
  emit(event: string, data?: unknown): void;
  on(event: string, callback: (data: unknown) => void): () => void;
  off(event: string, callback: (data: unknown) => void): void;
}

/**
 * @deprecated Use ShellContext instead.
 */
export interface LegacyShellNotification {
  show(options: {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
  }): void;
}

/**
 * @deprecated Use ShellContext instead.
 */
export interface LegacyShellContext {
  /** Authentication token */
  authToken?: string;

  /** Get current user */
  user: () => LegacyShellUser | null;

  /** Navigate to a route */
  navigate: (path: string) => void;

  /** Event bus for inter-plugin communication */
  eventBus: LegacyShellEventBus;

  /** Current theme */
  theme: LegacyShellTheme;

  /** Notification system */
  notifications?: LegacyShellNotification;

  /** Shell version */
  shellVersion?: string;
}
