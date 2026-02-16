/**
 * Shared Shell Context Module
 *
 * This module provides a central place for storing and accessing
 * the shell context, used by both App.tsx and mount.tsx entry points.
 */

export interface ShellContext {
  auth: {
    getUser: () => unknown;
    getToken: () => string | null;
    isAuthenticated: () => boolean;
  };
  notifications: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
    warning: (msg: string) => void;
  };
  navigate: (path: string) => void;
  eventBus: {
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (data: unknown) => void) => () => void;
    off: (event: string, handler: (data: unknown) => void) => void;
  };
  theme: { mode: 'light' | 'dark' };
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  permissions: { can: (resource: string, action: string) => boolean };
  shellVersion?: string;
  pluginBasePath?: string;
  config?: {
    apiBaseUrl?: string;
    publisherEndpointUrl?: string;
  };
}

// Singleton shell context storage
let shellContext: ShellContext | null = null;

/**
 * Set the shell context (called by mount functions)
 */
export function setShellContext(context: ShellContext | null): void {
  shellContext = context;
}

/**
 * Get the current shell context
 */
export function getShellContext(): ShellContext | null {
  return shellContext;
}

/**
 * Helper to show notifications via shell context
 */
export function notify(type: 'success' | 'error' | 'info' | 'warning', message: string): void {
  shellContext?.notifications?.[type]?.(message);
}

/**
 * Get auth token from shell context
 */
export function getAuthToken(): string | null {
  return shellContext?.auth?.getToken?.() || null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return shellContext?.auth?.isAuthenticated?.() || false;
}
