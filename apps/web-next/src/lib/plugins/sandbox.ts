/**
 * Plugin Sandbox
 *
 * Provides a restricted execution context for plugins.
 * Limits what plugins can access to prevent security issues.
 */

import DOMPurify from 'isomorphic-dompurify';
import type { ShellContext } from '@naap/plugin-sdk';

/**
 * Sandbox configuration options
 */
export interface SandboxOptions {
  /** Plugin name */
  pluginName: string;

  /** Base path for plugin routes */
  pluginBasePath: string;

  /** Enable strict mode (more restrictions) */
  strictMode?: boolean;

  /** Allowed navigation paths (regex patterns) */
  allowedNavigation?: RegExp[];

  /** Enable localStorage access */
  allowLocalStorage?: boolean;

  /** Enable sessionStorage access */
  allowSessionStorage?: boolean;

  /** Enable cookie access */
  allowCookies?: boolean;

  /** Maximum event listeners per event */
  maxEventListeners?: number;
}

/**
 * Default sandbox options
 */
const DEFAULT_OPTIONS: Partial<SandboxOptions> = {
  strictMode: true,
  allowLocalStorage: false,
  allowSessionStorage: false,
  allowCookies: false,
  maxEventListeners: 10,
};

/**
 * Creates a sandboxed shell context for a plugin.
 * Wraps the real context with security restrictions.
 */
export function createSandboxedContext(
  realContext: ShellContext,
  options: SandboxOptions
): ShellContext {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Track event listeners for cleanup
  const eventListeners = new Map<string, Set<(data: unknown) => void>>();

  // Sandboxed navigation - restrict to plugin routes
  const sandboxedNavigate = (path: string): void => {
    // Only allow navigation within plugin routes
    const isAllowed =
      path.startsWith(opts.pluginBasePath) ||
      path.startsWith('/') && !path.includes('..') && (
        opts.allowedNavigation?.some(pattern => pattern.test(path)) ?? true
      );

    if (!isAllowed && opts.strictMode) {
      console.warn(`[Sandbox] Plugin ${opts.pluginName} blocked navigation to: ${path}`);
      realContext.notifications?.warning?.(
        `Navigation to "${path}" is not allowed from this plugin`
      );
      return;
    }

    realContext.navigate(path);
  };

  // Global event prefixes that plugins can subscribe to without scoping
  // These are shell-level events that plugins need to react to
  const GLOBAL_EVENT_PREFIXES = [
    'shell:',
    'auth:',
    'theme:',
    'notification:',
    'navigation:',
    'team:',
    'tenant:',
  ];

  /**
   * Check if an event is global (should not be scoped)
   */
  function isGlobalEvent(event: string): boolean {
    return GLOBAL_EVENT_PREFIXES.some(prefix => event.startsWith(prefix));
  }

  // Sandboxed event bus - limit listeners, scope events, allow global subscriptions
  const sandboxedEventBus: ShellContext['eventBus'] = {
    emit: <T = unknown>(event: string, data?: T): void => {
      // Global events cannot be emitted by plugins in strict mode
      if (opts.strictMode && isGlobalEvent(event)) {
        console.warn(`[Sandbox] Plugin ${opts.pluginName} cannot emit global event: ${event}`);
        return;
      }

      // Prefix events with plugin name for isolation (only for non-global events)
      const scopedEvent = opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event;
      realContext.eventBus.emit(scopedEvent, data);
    },

    on: <T = unknown>(event: string, handler: (data: T) => void): (() => void) => {
      // Enforce listener limit
      const listeners = eventListeners.get(event) || new Set();
      if (listeners.size >= (opts.maxEventListeners || 10)) {
        console.warn(`[Sandbox] Plugin ${opts.pluginName} exceeded max event listeners for: ${event}`);
        return () => {};
      }

      listeners.add(handler as (data: unknown) => void);
      eventListeners.set(event, listeners);

      // Global events are subscribed directly (no scoping)
      // Plugin-specific events get plugin prefix in strict mode
      const scopedEvent = isGlobalEvent(event)
        ? event
        : (opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event);
      const unsubscribe = realContext.eventBus.on(scopedEvent, handler);

      return () => {
        listeners.delete(handler as (data: unknown) => void);
        unsubscribe();
      };
    },

    off: <T = unknown>(event: string, handler: (data: T) => void): void => {
      const listeners = eventListeners.get(event);
      listeners?.delete(handler as (data: unknown) => void);

      const scopedEvent = isGlobalEvent(event)
        ? event
        : (opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event);
      realContext.eventBus.off(scopedEvent, handler);
    },

    once: <T = unknown>(event: string, handler: (data: T) => void): (() => void) => {
      const scopedEvent = isGlobalEvent(event)
        ? event
        : (opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event);
      return realContext.eventBus.once?.(scopedEvent, handler) || (() => {});
    },

    request: async <TReq = unknown, TRes = unknown>(
      event: string,
      data?: TReq,
      options?: { timeout?: number; retries?: number; retryDelay?: number }
    ): Promise<TRes> => {
      // Scope requests to plugin namespace in strict mode
      const scopedEvent = opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event;
      return realContext.eventBus.request<TReq, TRes>(scopedEvent, data, options);
    },

    handleRequest: <TReq = unknown, TRes = unknown>(
      event: string,
      handler: (data: TReq) => TRes | Promise<TRes>
    ): (() => void) => {
      // Scope handlers to plugin namespace in strict mode
      const scopedEvent = opts.strictMode ? `plugin:${opts.pluginName}:${event}` : event;
      return realContext.eventBus.handleRequest<TReq, TRes>(scopedEvent, handler);
    },
  };

  // Sandboxed auth - read-only user info
  const sandboxedAuth = {
    ...realContext.auth,
    // Prevent token access in strict mode
    getToken: async (): Promise<string> => {
      if (opts.strictMode) {
        console.warn(`[Sandbox] Plugin ${opts.pluginName} attempted to access auth token`);
        return '';
      }
      return realContext.auth.getToken();
    },
    // Prevent login/logout
    login: (): void => {
      console.warn(`[Sandbox] Plugin ${opts.pluginName} attempted to trigger login`);
    },
    logout: (): void => {
      console.warn(`[Sandbox] Plugin ${opts.pluginName} attempted to trigger logout`);
    },
  };

  // Sandboxed logger - prefix with plugin name
  const sandboxedLogger = {
    debug: (message: string, meta?: Record<string, unknown>) => realContext.logger.debug(`[${opts.pluginName}] ${message}`, meta),
    info: (message: string, meta?: Record<string, unknown>) => realContext.logger.info(`[${opts.pluginName}] ${message}`, meta),
    warn: (message: string, meta?: Record<string, unknown>) => realContext.logger.warn(`[${opts.pluginName}] ${message}`, meta),
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => realContext.logger.error(`[${opts.pluginName}] ${message}`, error, meta),
    child: (context: Record<string, unknown>) => realContext.logger.child({ plugin: opts.pluginName, ...context }),
  };

  // Build sandboxed context
  const sandboxedContext: ShellContext = {
    auth: sandboxedAuth,
    notifications: realContext.notifications,
    navigate: sandboxedNavigate,
    eventBus: sandboxedEventBus,
    theme: realContext.theme, // Read-only
    logger: sandboxedLogger,
    permissions: realContext.permissions, // Read-only
    integrations: realContext.integrations, // Proxied through shell
    capabilities: realContext.capabilities,
    version: realContext.version || '1.0.0',
    // Include API client for backend communication (Phase 8 fix)
    api: realContext.api,
    // Include tenant and team context for multi-tenancy support
    tenant: realContext.tenant,
    team: realContext.team,
  };

  return sandboxedContext;
}

/**
 * Cleanup function for sandboxed context
 */
export function cleanupSandbox(pluginName: string): void {
  // Clear any global state the plugin might have set
  if (typeof window !== 'undefined') {
    // Remove any timers the plugin might have set
    // This is a best-effort cleanup

    // Clear any plugin-specific localStorage (if allowed)
    const prefix = `plugin_${pluginName}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  }
}

/**
 * Security utilities for plugins
 */
export const PluginSecurity = {
  /**
   * Validates that a URL is safe to load
   */
  isSafeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Block dangerous protocols
      if (['javascript:', 'data:', 'vbscript:'].includes(parsed.protocol)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Sanitizes HTML content using DOMPurify (allowlist-based, XSS-resistant).
   * Removes script tags, event handlers, and unsafe attributes.
   */
  sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'a'],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
  },

  /**
   * Validates JSON safely
   */
  safeJsonParse<T>(json: string, defaultValue: T): T {
    try {
      return JSON.parse(json);
    } catch {
      return defaultValue;
    }
  },

  /**
   * Creates a revocable proxy for an object
   */
  createRevocableProxy<T extends object>(target: T): { proxy: T; revoke: () => void } {
    return Proxy.revocable(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop);
        if (typeof value === 'function') {
          return value.bind(obj);
        }
        return value;
      },
      set() {
        // Block all writes in strict mode
        return false;
      },
    });
  },
};
