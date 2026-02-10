'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type User } from './auth-context';
import type { AuthUser } from '@naap/types';

// Re-export for consumers that import AuthUser from here
export type { AuthUser };

export interface IAuthService {
  getUser(): AuthUser | null;
  getToken(): Promise<string>;
  hasRole(role: string): boolean;
  hasPermission(resource: string, action: string): boolean;
  isAuthenticated(): boolean;
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}

export interface NotificationOptions {
  duration?: number;
  id?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface INotificationService {
  success(message: string, options?: NotificationOptions): void;
  error(message: string, options?: NotificationOptions): void;
  info(message: string, options?: NotificationOptions): void;
  warning(message: string, options?: NotificationOptions): void;
  dismiss(id: string): void;
  dismissAll(): void;
}

export interface Permission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'admin' | '*';
  scope?: string;
}

export interface IPermissionService {
  can(resource: string, action: string): boolean;
  getPermissions(): Permission[];
  require(resource: string, action: string): void;
}

export interface LogMeta {
  [key: string]: unknown;
}

export interface ILoggerService {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, error?: Error, meta?: LogMeta): void;
  child(context: LogMeta): ILoggerService;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  error: string;
  warning: string;
  success: string;
  info: string;
}

export interface IThemeService {
  mode: 'light' | 'dark';
  colors: ThemeColors;
  toggle(): void;
  setMode(mode: 'light' | 'dark'): void;
  onChange(callback: (mode: 'light' | 'dark') => void): () => void;
}

export interface EventRequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface IEventBus {
  emit<T = unknown>(event: string, data?: T): void;
  on<T = unknown>(event: string, callback: (data: T) => void): () => void;
  off<T = unknown>(event: string, callback: (data: T) => void): void;
  once<T = unknown>(event: string, callback: (data: T) => void): () => void;
  request<TReq = unknown, TRes = unknown>(
    event: string,
    data?: TReq,
    options?: EventRequestOptions
  ): Promise<TRes>;
  handleRequest<TReq = unknown, TRes = unknown>(
    event: string,
    handler: (data: TReq) => TRes | Promise<TRes>
  ): () => void;
}

// Integration Services
export interface AICompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface AICompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IAIService {
  complete(prompt: string, options?: AICompletionOptions): Promise<AICompletionResult>;
  chat(messages: ChatMessage[], options?: AICompletionOptions): Promise<AICompletionResult>;
  embed(text: string | string[]): Promise<number[][]>;
  isConfigured(): boolean;
  getModels(): Promise<string[]>;
}

export interface StorageUploadOptions {
  contentType?: string;
  access?: 'public' | 'private';
  metadata?: Record<string, string>;
  onProgress?: (progress: number) => void;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
  url?: string;
}

export interface StorageUploadResult {
  key: string;
  url: string;
  size: number;
}

export interface IStorageService {
  upload(file: File | Blob, path: string, options?: StorageUploadOptions): Promise<StorageUploadResult>;
  download(path: string): Promise<Blob>;
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<StorageObject[]>;
  isConfigured(): boolean;
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailOptions {
  from?: EmailRecipient;
  replyTo?: EmailRecipient;
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export interface IEmailService {
  send(
    to: EmailRecipient | EmailRecipient[],
    subject: string,
    body: string,
    options?: EmailOptions
  ): Promise<{ messageId: string }>;
  sendTemplate(
    to: EmailRecipient | EmailRecipient[],
    templateId: string,
    data: Record<string, unknown>,
    options?: EmailOptions
  ): Promise<{ messageId: string }>;
  isConfigured(): boolean;
}

export interface IIntegrationService {
  ai: IAIService;
  storage: IStorageService;
  email: IEmailService;
  isConfigured(type: 'ai' | 'storage' | 'email'): boolean;
  getAvailable(): Array<{ type: string; configured: boolean }>;
}

// Tenant Service
export interface TenantInstallation {
  id: string;
  userId: string;
  deploymentId: string;
  status: string;
  enabled: boolean;
  order: number;
  pinned: boolean;
  installedAt: string;
  config?: {
    settings: Record<string, unknown>;
  };
  deployment: {
    id: string;
    packageId: string;
    versionId: string;
    status: string;
    frontendUrl: string | null;
    backendUrl: string | null;
    healthStatus: string | null;
    package: {
      name: string;
      displayName: string;
      icon: string | null;
      category: string;
    };
    version: {
      version: string;
      manifest: unknown;
    };
  };
}

export interface TenantConfig {
  settings: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

export interface ITenantService {
  listInstallations(): Promise<TenantInstallation[]>;
  getInstallation(installId: string): Promise<TenantInstallation | null>;
  getInstallationByPlugin(pluginName: string): Promise<TenantInstallation | null>;
  install(packageName: string, config?: Record<string, unknown>): Promise<{
    installation: TenantInstallation;
    isFirstInstall: boolean;
  }>;
  uninstall(installId: string): Promise<{
    success: boolean;
    shouldCleanup: boolean;
  }>;
  updatePreferences(installId: string, preferences: {
    enabled?: boolean;
    order?: number;
    pinned?: boolean;
  }): Promise<TenantInstallation>;
  getConfig(installId: string): Promise<TenantConfig>;
  updateConfig(installId: string, config: Partial<TenantConfig>): Promise<TenantConfig>;
  hasPlugin(pluginName: string): Promise<boolean>;
}

export interface ITenantContext {
  currentInstallation: TenantInstallation | null;
  isTenantContext: boolean;
  setCurrentPlugin: (pluginName: string | null) => Promise<void>;
  refreshInstallation: () => Promise<void>;
  isLoading: boolean;
}

// Team Context
export interface Team {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  avatarUrl?: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    members: number;
    pluginInstalls: number;
  };
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invitedBy?: string | null;
  joinedAt: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface ITeamContext {
  currentTeam: Team | null;
  currentMember: TeamMember | null;
  setCurrentTeam: (teamId: string | null) => Promise<void>;
  isTeamContext: boolean;
  memberRole: string | null;
  hasTeamPermission: (permission: string) => boolean;
  refreshTeam: () => Promise<void>;
}

// API Client - must match plugin-sdk IApiClient interface
export interface IApiClient {
  get<T = unknown>(url: string, options?: RequestInit): Promise<T>;
  post<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  put<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  patch<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  delete<T = unknown>(url: string, options?: RequestInit): Promise<T>;
}

// Capability Service
export type ShellCapability =
  | 'ai'
  | 'storage'
  | 'email'
  | 'payments'
  | 'notifications'
  | 'teams'
  | 'tenants'
  | 'websocket'
  | 'analytics'
  | 'search'
  | string;

export interface CapabilityInfo {
  available: boolean;
  configured: boolean;
  version?: string;
  provider?: string;
}

export interface ICapabilityService {
  has(capability: ShellCapability): boolean;
  info(capability: ShellCapability): CapabilityInfo;
  getAll(): Record<string, CapabilityInfo>;
  hasAll(capabilities: ShellCapability[]): boolean;
  hasAny(capabilities: ShellCapability[]): boolean;
}

// Full Shell Context matching plugin-sdk
export interface ShellContext {
  auth: IAuthService;
  navigate: (path: string) => void;
  eventBus: IEventBus;
  theme: IThemeService;
  notifications: INotificationService;
  integrations: IIntegrationService;
  logger: ILoggerService;
  permissions: IPermissionService;
  tenant?: ITenantService;
  tenantContext?: ITenantContext;
  team?: ITeamContext;
  api?: IApiClient;
  capabilities?: ICapabilityService;
  version: string;
}

// Extended context for internal shell use
export interface ShellContextValue extends ShellContext {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isDark: boolean;
  toggleTheme: () => void;
}

// ============================================
// Service Implementations
// ============================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const STORAGE_KEYS = {
  AUTH_TOKEN: 'naap_auth_token',
  SIDEBAR: 'naap_shell_sidebar_open',
  THEME: 'theme',
  TEAM: 'naap_current_team',
} as const;

// Team role permissions
const TEAM_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['team.manage', 'team.delete', 'members.manage', 'members.invite', 'plugins.install', 'plugins.uninstall', 'plugins.configure', 'access.manage'],
  admin: ['members.manage', 'members.invite', 'plugins.install', 'plugins.uninstall', 'plugins.configure', 'access.manage'],
  member: ['plugins.use', 'plugins.configure.personal'],
  viewer: ['plugins.view'],
};

// Default theme colors - Professional light mode (WCAG AA compliant)
const DEFAULT_COLORS: ThemeColors = {
  primary: '#059669',      // Emerald-600
  secondary: '#475569',    // Slate-600
  accent: '#2563eb',       // Blue-600
  background: '#ffffff',   // Pure white
  text: '#0f172a',         // Slate-900 (7:1 contrast)
  error: '#dc2626',        // Rose-600
  warning: '#d97706',      // Amber-600
  success: '#059669',      // Emerald-600
  info: '#2563eb',         // Blue-600
};

// Dark mode colors - NAAP Brand Theme
const DARK_COLORS: ThemeColors = {
  primary: '#10b981',      // Emerald-500
  secondary: '#9ca3af',    // Gray-400
  accent: '#3b82f6',       // Blue-500
  background: '#0a0f1a',   // Deep navy
  text: '#f9fafb',         // Gray-50
  error: '#f43f5e',        // Rose-500
  warning: '#f59e0b',      // Amber-500
  success: '#10b981',      // Emerald-500
  info: '#3b82f6',         // Blue-500
};

// Global event prefixes that should NOT be tenant-scoped
// These events are shell-level and work across team contexts
const GLOBAL_EVENT_PREFIXES = [
  'shell:',    // Shell system events
  'auth:',     // Authentication events (login, logout, etc.)
  'theme:',    // Theme changes
  'notification:', // Toast notifications
  'navigation:',   // Navigation events
  'tenant:',   // Tenant context changes
  'team:',     // Team context changes (switching teams)
  'dashboard:',    // Dashboard data contracts (system-level, not team-scoped)
];

/**
 * Check if an event should be global (not tenant-scoped)
 */
function isGlobalEvent(event: string): boolean {
  return GLOBAL_EVENT_PREFIXES.some(prefix => event.startsWith(prefix)) || event === '*';
}

/**
 * Create a tenant-aware event bus
 * - Team-scoped events: Plugin business events are scoped to current team
 * - Global events: shell/auth/theme events work across all contexts
 * - Request/response pattern for plugin-to-plugin communication
 */
function createTenantAwareEventBus(getTeamId: () => string | null): IEventBus {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const onceListeners = new Map<string, Set<(data: unknown) => void>>();
  const requestHandlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>();

  /**
   * Get the scoped event name based on current team context
   */
  function getScopedEvent(event: string): string {
    if (isGlobalEvent(event)) {
      return event;
    }
    const teamId = getTeamId();
    return teamId ? `team:${teamId}:${event}` : event;
  }

  /**
   * Debug logging in development
   */
  function debugLog(action: string, event: string, data?: unknown) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[EventBus] ${action}: ${event}`, data !== undefined ? data : '');
    }
  }

  return {
    emit: <T = unknown>(event: string, data?: T): void => {
      debugLog('emit', event, data);

      // For global events, emit directly
      if (isGlobalEvent(event)) {
        listeners.get(event)?.forEach(handler => handler(data));
        listeners.get('*')?.forEach(handler => handler({ event, data }));

        // Handle once listeners for global events
        onceListeners.get(event)?.forEach(handler => {
          handler(data);
          onceListeners.get(event)?.delete(handler);
        });
        return;
      }

      // For plugin/business events, scope to team
      const teamId = getTeamId();
      if (teamId) {
        const scopedEvent = `team:${teamId}:${event}`;
        listeners.get(scopedEvent)?.forEach(handler => handler(data));

        // Handle once listeners for scoped events
        onceListeners.get(scopedEvent)?.forEach(handler => {
          handler(data);
          onceListeners.get(scopedEvent)?.delete(handler);
        });
      }

      // Also emit to non-scoped listeners for backward compatibility
      listeners.get(event)?.forEach(handler => handler(data));

      // Also notify wildcard listeners with full event info
      listeners.get('*')?.forEach(handler => handler({ event, data, teamId }));
    },

    on: <T = unknown>(event: string, callback: (data: T) => void): (() => void) => {
      const scopedEvent = getScopedEvent(event);
      debugLog('on', scopedEvent);

      if (!listeners.has(scopedEvent)) {
        listeners.set(scopedEvent, new Set());
      }
      listeners.get(scopedEvent)!.add(callback as (data: unknown) => void);

      // For global events, also ensure handlers work without team context
      // This is backward compatible - plugins listening to 'shell:*' always work
      return () => {
        listeners.get(scopedEvent)?.delete(callback as (data: unknown) => void);
      };
    },

    off: <T = unknown>(event: string, callback: (data: T) => void): void => {
      const scopedEvent = getScopedEvent(event);
      debugLog('off', scopedEvent);
      listeners.get(scopedEvent)?.delete(callback as (data: unknown) => void);
    },

    once: <T = unknown>(event: string, callback: (data: T) => void): (() => void) => {
      const scopedEvent = getScopedEvent(event);
      debugLog('once', scopedEvent);

      if (!onceListeners.has(scopedEvent)) {
        onceListeners.set(scopedEvent, new Set());
      }
      onceListeners.get(scopedEvent)!.add(callback as (data: unknown) => void);
      return () => onceListeners.get(scopedEvent)?.delete(callback as (data: unknown) => void);
    },

    request: async <TReq = unknown, TRes = unknown>(
      event: string,
      data?: TReq,
      options?: EventRequestOptions
    ): Promise<TRes> => {
      const { timeout = 5000, retries = 0, retryDelay = 1000 } = options || {};
      const scopedEvent = getScopedEvent(event);
      debugLog('request', scopedEvent, { data, timeout, retries });

      // Always log dashboard request attempts (critical for debugging provider loading)
      if (event.startsWith('dashboard:')) {
        const allKeys = [...requestHandlers.keys()];
        console.log(`[EventBus] request("${event}") → scoped: "${scopedEvent}", registered handlers: [${allKeys.join(', ')}]`);
      }

      const attemptRequest = async (attempt: number): Promise<TRes> => {
        const handler = requestHandlers.get(scopedEvent);

        if (!handler) {
          // Check if there's a non-scoped handler as fallback
          const fallbackHandler = requestHandlers.get(event);
          if (!fallbackHandler) {
            if (event.startsWith('dashboard:')) {
              console.warn(`[EventBus] NO_HANDLER for "${scopedEvent}" — all registered keys:`, [...requestHandlers.keys()]);
            }
            const error = new Error(`No handler registered for event: ${event}`);
            (error as any).code = 'NO_HANDLER';
            (error as any).event = event;
            throw error;
          }
        }

        const activeHandler = requestHandlers.get(scopedEvent) || requestHandlers.get(event);

        return new Promise<TRes>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (attempt < retries) {
              debugLog('request:retry', scopedEvent, { attempt: attempt + 1 });
              setTimeout(() => {
                attemptRequest(attempt + 1).then(resolve).catch(reject);
              }, retryDelay);
            } else {
              const error = new Error(`Request timeout for event: ${event} (${timeout}ms)`);
              (error as any).code = 'TIMEOUT';
              (error as any).event = event;
              reject(error);
            }
          }, timeout);

          try {
            const result = activeHandler!(data);
            if (result instanceof Promise) {
              result
                .then((res) => {
                  clearTimeout(timeoutId);
                  debugLog('request:response', scopedEvent, res);
                  resolve(res as TRes);
                })
                .catch((err) => {
                  clearTimeout(timeoutId);
                  const error = new Error(`Handler error for event: ${event} - ${err.message}`);
                  (error as any).code = 'HANDLER_ERROR';
                  (error as any).event = event;
                  (error as any).cause = err;
                  reject(error);
                });
            } else {
              clearTimeout(timeoutId);
              debugLog('request:response', scopedEvent, result);
              resolve(result as TRes);
            }
          } catch (err) {
            clearTimeout(timeoutId);
            const error = new Error(`Handler error for event: ${event} - ${(err as Error).message}`);
            (error as any).code = 'HANDLER_ERROR';
            (error as any).event = event;
            (error as any).cause = err;
            reject(error);
          }
        });
      };

      return attemptRequest(0);
    },

    handleRequest: <TReq = unknown, TRes = unknown>(
      event: string,
      handler: (data: TReq) => TRes | Promise<TRes>
    ): (() => void) => {
      const scopedEvent = getScopedEvent(event);
      debugLog('handleRequest:register', scopedEvent);

      // Always log dashboard handler registration (critical for debugging provider loading)
      if (event.startsWith('dashboard:')) {
        console.log(`[EventBus] ✅ handleRequest REGISTERED: "${scopedEvent}" (raw: "${event}")`);
        console.log(`[EventBus]    Total handlers: ${requestHandlers.size + 1}, keys:`, [...requestHandlers.keys(), scopedEvent]);
      }

      if (requestHandlers.has(scopedEvent)) {
        console.warn(`[EventBus] Overwriting existing handler for: ${scopedEvent}`);
      }

      requestHandlers.set(scopedEvent, handler as (data: unknown) => unknown | Promise<unknown>);

      return () => {
        debugLog('handleRequest:unregister', scopedEvent);
        if (event.startsWith('dashboard:')) {
          console.log(`[EventBus] handleRequest UNREGISTERED: "${scopedEvent}"`);
        }
        requestHandlers.delete(scopedEvent);
      };
    },
  };
}

// Create logger service
function createLoggerService(context: LogMeta = {}): ILoggerService {
  const prefix = context.plugin ? `[Plugin:${context.plugin}]` : '[Shell]';

  return {
    debug: (message: string, meta?: LogMeta) => {
      if (process.env.NODE_ENV === 'development') {
        console.debug(prefix, message, meta || '');
      }
    },
    info: (message: string, meta?: LogMeta) => {
      console.info(prefix, message, meta || '');
    },
    warn: (message: string, meta?: LogMeta) => {
      console.warn(prefix, message, meta || '');
    },
    error: (message: string, error?: Error, meta?: LogMeta) => {
      console.error(prefix, message, error, meta || '');
    },
    child: (childContext: LogMeta): ILoggerService => {
      return createLoggerService({ ...context, ...childContext });
    },
  };
}

// Create notification service
function createNotificationService(eventBus: IEventBus): INotificationService {
  const activeNotifications = new Map<string, NodeJS.Timeout>();
  let idCounter = 0;

  const show = (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: NotificationOptions) => {
    const id = options?.id || `notification-${++idCounter}`;
    const duration = options?.duration ?? 5000;

    eventBus.emit('notification:show', { id, type, message, action: options?.action });

    // Auto-dismiss unless duration is 0
    if (duration > 0) {
      if (activeNotifications.has(id)) {
        clearTimeout(activeNotifications.get(id));
      }
      const timeout = setTimeout(() => {
        eventBus.emit('notification:dismiss', { id });
        activeNotifications.delete(id);
      }, duration);
      activeNotifications.set(id, timeout);
    }
  };

  return {
    success: (message: string, options?: NotificationOptions) => show('success', message, options),
    error: (message: string, options?: NotificationOptions) => show('error', message, options),
    info: (message: string, options?: NotificationOptions) => show('info', message, options),
    warning: (message: string, options?: NotificationOptions) => show('warning', message, options),
    dismiss: (id: string) => {
      if (activeNotifications.has(id)) {
        clearTimeout(activeNotifications.get(id));
        activeNotifications.delete(id);
      }
      eventBus.emit('notification:dismiss', { id });
    },
    dismissAll: () => {
      activeNotifications.forEach((timeout, id) => {
        clearTimeout(timeout);
        eventBus.emit('notification:dismiss', { id });
      });
      activeNotifications.clear();
    },
  };
}

// Create API client
function createApiClient(getToken: () => Promise<string>): IApiClient {
  async function request<T>(method: string, url: string, body?: unknown, options?: RequestInit): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T = unknown>(url: string, options?: RequestInit) => request<T>('GET', url, undefined, options),
    post: <T = unknown>(url: string, body?: unknown, options?: RequestInit) => request<T>('POST', url, body, options),
    put: <T = unknown>(url: string, body?: unknown, options?: RequestInit) => request<T>('PUT', url, body, options),
    patch: <T = unknown>(url: string, body?: unknown, options?: RequestInit) => request<T>('PATCH', url, body, options),
    delete: <T = unknown>(url: string, options?: RequestInit) => request<T>('DELETE', url, undefined, options),
  };
}

// Create integration service (stubs - to be configured)
function createIntegrationService(api: IApiClient): IIntegrationService {
  const configured = {
    ai: Boolean(process.env.NEXT_PUBLIC_AI_ENABLED),
    storage: Boolean(process.env.NEXT_PUBLIC_STORAGE_ENABLED),
    email: Boolean(process.env.NEXT_PUBLIC_EMAIL_ENABLED),
  };

  const ai: IAIService = {
    complete: async (prompt, options) => {
      return api.post('/v1/integrations/ai/complete', { prompt, ...options }) as Promise<AICompletionResult>;
    },
    chat: async (messages, options) => {
      return api.post('/v1/integrations/ai/chat', { messages, ...options }) as Promise<AICompletionResult>;
    },
    embed: async (text) => {
      return api.post('/v1/integrations/ai/embed', { text }) as Promise<number[][]>;
    },
    isConfigured: () => configured.ai,
    getModels: async () => {
      const result = await api.get('/v1/integrations/ai/models') as { models: string[] };
      return result.models;
    },
  };

  const storage: IStorageService = {
    upload: async (file, path, options) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', path);
      if (options) {
        formData.append('options', JSON.stringify(options));
      }
      const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) : null;
      const response = await fetch(`${API_BASE}/v1/integrations/storage/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      return response.json();
    },
    download: async (path) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) : null;
      const response = await fetch(`${API_BASE}/v1/integrations/storage/download?path=${encodeURIComponent(path)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Download failed');
      return response.blob();
    },
    getSignedUrl: async (path, expiresIn) => {
      const result = await api.post('/v1/integrations/storage/signed-url', { path, expiresIn }) as { url: string };
      return result.url;
    },
    delete: async (path) => {
      await api.delete(`/v1/integrations/storage?path=${encodeURIComponent(path)}`);
    },
    list: async (prefix) => {
      const result = await api.get(`/v1/integrations/storage/list?prefix=${encodeURIComponent(prefix || '')}`) as { objects: StorageObject[] };
      return result.objects;
    },
    isConfigured: () => configured.storage,
  };

  const email: IEmailService = {
    send: async (to, subject, body, options) => {
      return api.post('/v1/integrations/email/send', { to, subject, body, ...options }) as Promise<{ messageId: string }>;
    },
    sendTemplate: async (to, templateId, data, options) => {
      return api.post('/v1/integrations/email/send-template', { to, templateId, data, ...options }) as Promise<{ messageId: string }>;
    },
    isConfigured: () => configured.email,
  };

  return {
    ai,
    storage,
    email,
    isConfigured: (type) => configured[type],
    getAvailable: () => [
      { type: 'ai', configured: configured.ai },
      { type: 'storage', configured: configured.storage },
      { type: 'email', configured: configured.email },
    ],
  };
}

// Create capability service
function createCapabilityService(integrations: IIntegrationService): ICapabilityService {
  const capabilities: Record<string, CapabilityInfo> = {
    ai: { available: true, configured: integrations.isConfigured('ai'), provider: 'openai' },
    storage: { available: true, configured: integrations.isConfigured('storage'), provider: 'vercel-blob' },
    email: { available: true, configured: integrations.isConfigured('email'), provider: 'sendgrid' },
    notifications: { available: true, configured: true },
    teams: { available: true, configured: true },
    tenants: { available: true, configured: true },
    websocket: { available: Boolean(process.env.NEXT_PUBLIC_ABLY_KEY), configured: Boolean(process.env.NEXT_PUBLIC_ABLY_KEY), provider: 'ably' },
    analytics: { available: false, configured: false },
    search: { available: false, configured: false },
    payments: { available: false, configured: false },
  };

  return {
    has: (cap) => capabilities[cap]?.configured ?? false,
    info: (cap) => capabilities[cap] ?? { available: false, configured: false },
    getAll: () => capabilities,
    hasAll: (caps) => caps.every(cap => capabilities[cap]?.configured),
    hasAny: (caps) => caps.some(cap => capabilities[cap]?.configured),
  };
}

// ============================================
// Context and Provider
// ============================================

const ShellContextReact = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const authContext = useAuth();
  const authStateCallbacksRef = useRef<Set<(user: AuthUser | null) => void>>(new Set());
  const themeCallbacksRef = useRef<Set<(mode: 'light' | 'dark') => void>>(new Set());

  // Sidebar state
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEYS.SIDEBAR);
    return stored !== 'false';
  });

  // Theme state
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });

  // Team state
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [, setTeamLoading] = useState(false);

  // Ref for current team ID (used by event bus without triggering re-renders)
  const currentTeamIdRef = useRef<string | null>(null);

  // Tenant state
  const [currentInstallation, setCurrentInstallation] = useState<TenantInstallation | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);

  // Event bus (singleton) - tenant-aware for multi-tenancy isolation
  // Uses ref to get current team ID so it doesn't need to recreate on team change
  const eventBus = useMemo(() => createTenantAwareEventBus(() => currentTeamIdRef.current), []);

  // Toggle sidebar
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEYS.SIDEBAR, String(next));
      return next;
    });
  }, []);

  // Toggle theme
  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem(STORAGE_KEYS.THEME, next ? 'dark' : 'light');
      eventBus.emit('theme:change', { mode: next ? 'dark' : 'light' });
      themeCallbacksRef.current.forEach(cb => cb(next ? 'dark' : 'light'));
      return next;
    });
  }, [eventBus]);

  // Set theme mode
  const setThemeMode = useCallback((mode: 'light' | 'dark') => {
    const newIsDark = mode === 'dark';
    setIsDark(newIsDark);
    document.documentElement.classList.toggle('dark', newIsDark);
    localStorage.setItem(STORAGE_KEYS.THEME, mode);
    eventBus.emit('theme:change', { mode });
    themeCallbacksRef.current.forEach(cb => cb(mode));
  }, [eventBus]);

  // Get token
  const getToken = useCallback(async (): Promise<string> => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || '';
  }, []);

  // Convert User to AuthUser
  const toAuthUser = useCallback((user: User | null): AuthUser | null => {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      address: user.address,
      walletAddress: user.address,
      roles: user.roles || [],
      permissions: user.permissions || [],
    };
  }, []);

  // Notify auth state changes
  useEffect(() => {
    const authUser = toAuthUser(authContext.user);
    authStateCallbacksRef.current.forEach(cb => cb(authUser));
    eventBus.emit(authContext.isAuthenticated ? 'auth:login' : 'auth:logout', authUser);
  }, [authContext.user, authContext.isAuthenticated, toAuthUser, eventBus]);

  // Navigation with event emission
  const navigate = useCallback((path: string) => {
    eventBus.emit('navigation:change', { path });
    router.push(path);
  }, [router, eventBus]);

  // Create services
  const logger = useMemo(() => createLoggerService(), []);
  const notifications = useMemo(() => createNotificationService(eventBus), [eventBus]);
  const api = useMemo(() => createApiClient(getToken), [getToken]);
  const integrations = useMemo(() => createIntegrationService(api), [api]);
  const capabilities = useMemo(() => createCapabilityService(integrations), [integrations]);

  // Auth service -- uses refs so that UMD-loaded plugins always get the latest
  // auth state even though they receive a snapshot of the shell context at mount time.
  // Without refs, getUser() would be a stale closure returning null if the plugin
  // mounted before auth was fully initialized.
  const authContextRef = useRef(authContext);
  authContextRef.current = authContext;

  const auth = useMemo<IAuthService>(() => ({
    getUser: () => toAuthUser(authContextRef.current.user),
    getToken,
    hasRole: (role: string) => authContextRef.current.hasRole(role),
    hasPermission: (resource: string, action: string) => {
      const permission = `${resource}:${action}`;
      return authContextRef.current.hasPermission(permission);
    },
    isAuthenticated: () => authContextRef.current.isAuthenticated,
    onAuthStateChange: (callback: (user: AuthUser | null) => void) => {
      authStateCallbacksRef.current.add(callback);
      return () => authStateCallbacksRef.current.delete(callback);
    },
  }), [getToken, toAuthUser]);

  // Theme service
  const theme = useMemo<IThemeService>(() => ({
    mode: isDark ? 'dark' : 'light',
    colors: isDark ? DARK_COLORS : DEFAULT_COLORS,
    toggle: toggleTheme,
    setMode: setThemeMode,
    onChange: (callback: (mode: 'light' | 'dark') => void) => {
      themeCallbacksRef.current.add(callback);
      return () => themeCallbacksRef.current.delete(callback);
    },
  }), [isDark, toggleTheme, setThemeMode]);

  // Permission service
  const permissions = useMemo<IPermissionService>(() => ({
    can: (resource: string, action: string) => {
      const user = authContext.user;
      if (!user) return false;

      // Admin bypass
      if (user.roles?.includes('system:admin')) return true;

      const permission = `${resource}:${action}`;
      if (user.permissions?.includes('*')) return true;
      return user.permissions?.includes(permission) ?? false;
    },
    getPermissions: () => {
      const user = authContext.user;
      if (!user?.permissions) return [];
      return user.permissions.map(p => {
        if (typeof p === 'string') {
          const [resource, action] = p.split(':');
          return { resource, action: action as Permission['action'] };
        }
        return p as Permission;
      });
    },
    require: (resource: string, action: string) => {
      if (!permissions.can(resource, action)) {
        throw new Error(`Permission denied: ${resource}:${action}`);
      }
    },
  }), [authContext.user]);

  // Team context
  const fetchTeam = useCallback(async (teamId: string | null) => {
    if (!teamId) {
      currentTeamIdRef.current = null; // Update ref for event bus scoping
      setCurrentTeam(null);
      setCurrentMember(null);
      localStorage.removeItem(STORAGE_KEYS.TEAM);
      eventBus.emit('team:change', { teamId: null, team: null, member: null });
      return;
    }

    setTeamLoading(true);
    try {
      const teamData = await api.get(`/v1/teams/${teamId}`) as { team: Team; member: TeamMember };
      currentTeamIdRef.current = teamId; // Update ref for event bus scoping
      setCurrentTeam(teamData.team);
      setCurrentMember(teamData.member);
      localStorage.setItem(STORAGE_KEYS.TEAM, teamId);
      eventBus.emit('team:change', { teamId, team: teamData.team, member: teamData.member });
    } catch (error) {
      console.error('Failed to fetch team:', error);
      currentTeamIdRef.current = null; // Clear ref on error
      eventBus.emit('team:error', { teamId, error });
      setCurrentTeam(null);
      setCurrentMember(null);
    } finally {
      setTeamLoading(false);
    }
  }, [api, eventBus]);

  // Load team on mount
  useEffect(() => {
    if (authContext.isAuthenticated && typeof window !== 'undefined') {
      const savedTeamId = localStorage.getItem(STORAGE_KEYS.TEAM);
      if (savedTeamId) {
        fetchTeam(savedTeamId);
      }
    }
  }, [authContext.isAuthenticated, fetchTeam]);

  const team = useMemo<ITeamContext>(() => ({
    currentTeam,
    currentMember,
    setCurrentTeam: fetchTeam,
    isTeamContext: currentTeam !== null,
    memberRole: currentMember?.role || null,
    hasTeamPermission: (permission: string) => {
      if (!currentMember) return false;
      const rolePermissions = TEAM_ROLE_PERMISSIONS[currentMember.role] || [];
      return rolePermissions.includes(permission);
    },
    refreshTeam: async () => {
      if (currentTeam) {
        await fetchTeam(currentTeam.id);
      }
    },
  }), [currentTeam, currentMember, fetchTeam]);

  // Tenant service
  const tenant = useMemo<ITenantService>(() => {
    const listInstallations = () => api.get('/v1/tenant/installations') as Promise<TenantInstallation[]>;
    const getInstallation = async (installId: string): Promise<TenantInstallation | null> => {
      try {
        return await api.get(`/v1/tenant/installations/${installId}`) as TenantInstallation;
      } catch {
        return null;
      }
    };
    const getInstallationByPlugin = async (pluginName: string): Promise<TenantInstallation | null> => {
      try {
        const installations = await api.get('/v1/tenant/installations') as TenantInstallation[];
        return installations.find(i => i.deployment.package.name === pluginName) || null;
      } catch {
        return null;
      }
    };
    const install = (packageName: string, config?: Record<string, unknown>) =>
      api.post('/v1/tenant/installations', { packageName, config }) as Promise<{ installation: TenantInstallation; isFirstInstall: boolean }>;
    const uninstall = (installId: string) =>
      api.delete(`/v1/tenant/installations/${installId}`) as Promise<{ success: boolean; shouldCleanup: boolean }>;
    const updatePreferences = (installId: string, preferences: { enabled?: boolean; order?: number; pinned?: boolean }) =>
      api.patch(`/v1/tenant/installations/${installId}/preferences`, preferences) as Promise<TenantInstallation>;
    const getConfig = (installId: string) =>
      api.get(`/v1/tenant/installations/${installId}/config`) as Promise<TenantConfig>;
    const updateConfig = (installId: string, config: Partial<TenantConfig>) =>
      api.put(`/v1/tenant/installations/${installId}/config`, config) as Promise<TenantConfig>;
    const hasPlugin = async (pluginName: string): Promise<boolean> => {
      const installation = await getInstallationByPlugin(pluginName);
      return installation !== null;
    };
    return {
      listInstallations,
      getInstallation,
      getInstallationByPlugin,
      install,
      uninstall,
      updatePreferences,
      getConfig,
      updateConfig,
      hasPlugin,
    };
  }, [api]);

  // Tenant context
  const tenantContext = useMemo<ITenantContext>(() => ({
    currentInstallation,
    isTenantContext: currentInstallation !== null,
    setCurrentPlugin: async (pluginName: string | null) => {
      if (!pluginName) {
        setCurrentInstallation(null);
        return;
      }
      setTenantLoading(true);
      try {
        const installation = await tenant.getInstallationByPlugin(pluginName);
        setCurrentInstallation(installation);
        eventBus.emit('tenant:change', { pluginName, installation });
      } catch (error) {
        console.error('Failed to set current plugin:', error);
        eventBus.emit('tenant:error', { pluginName, error });
      } finally {
        setTenantLoading(false);
      }
    },
    refreshInstallation: async () => {
      if (currentInstallation) {
        const installation = await tenant.getInstallation(currentInstallation.id);
        setCurrentInstallation(installation);
      }
    },
    isLoading: tenantLoading,
  }), [currentInstallation, tenantLoading, tenant, eventBus]);

  // Build context value
  const value = useMemo<ShellContextValue>(() => ({
    auth,
    navigate,
    eventBus,
    theme,
    notifications,
    integrations,
    logger,
    permissions,
    tenant,
    tenantContext,
    team,
    api,
    capabilities,
    version: '2.0.0',
    isSidebarOpen,
    toggleSidebar,
    isDark,
    toggleTheme,
  }), [
    auth, navigate, eventBus, theme, notifications, integrations, logger,
    permissions, tenant, tenantContext, team, api, capabilities,
    isSidebarOpen, toggleSidebar, isDark, toggleTheme
  ]);

  return (
    <ShellContextReact.Provider value={value}>
      {children}
    </ShellContextReact.Provider>
  );
}

export function useShell() {
  const context = useContext(ShellContextReact);
  if (!context) {
    throw new Error('useShell must be used within a ShellProvider');
  }
  return context;
}

// Export shell services for plugins (matches ShellContext interface from plugin-sdk)
export function useShellServices(): ShellContext {
  const shell = useShell();
  return {
    auth: shell.auth,
    navigate: shell.navigate,
    eventBus: shell.eventBus,
    theme: shell.theme,
    notifications: shell.notifications,
    integrations: shell.integrations,
    logger: shell.logger,
    permissions: shell.permissions,
    tenant: shell.tenant,
    tenantContext: shell.tenantContext,
    team: shell.team,
    api: shell.api,
    capabilities: shell.capabilities,
    version: shell.version,
  };
}

// Convenience hooks for plugins
export function useAuthService(): IAuthService {
  return useShell().auth;
}

export function usePermissions(): IPermissionService {
  return useShell().permissions;
}

export function useTeam(): ITeamContext {
  return useShell().team!;
}

export function useTenant(): ITenantService {
  return useShell().tenant!;
}

export function useTenantContext(): ITenantContext {
  return useShell().tenantContext!;
}

export function useIntegrations(): IIntegrationService {
  return useShell().integrations;
}

export function useEvents(): IEventBus {
  return useShell().eventBus;
}

export function useNotify(): INotificationService {
  return useShell().notifications;
}

export function useLogger(context?: LogMeta): ILoggerService {
  const shell = useShell();
  return useMemo(() => context ? shell.logger.child(context) : shell.logger, [shell.logger, context]);
}

export function useThemeService(): IThemeService {
  return useShell().theme;
}

export function useNavigate(): (path: string) => void {
  return useShell().navigate;
}

export function useCapabilities(): ICapabilityService {
  return useShell().capabilities!;
}

export function useCapability(capability: ShellCapability): boolean {
  return useShell().capabilities?.has(capability) ?? false;
}
