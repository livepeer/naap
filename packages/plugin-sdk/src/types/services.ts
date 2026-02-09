/**
 * Generalized Service Interfaces
 * 
 * These interfaces define the contract between plugins and shell services.
 * Following SOLID principles:
 * - Interface Segregation: Each service has its own interface
 * - Dependency Inversion: Plugins depend on interfaces, not implementations
 */

// ============================================
// Notification Service
// ============================================

export interface NotificationOptions {
  /** Duration in milliseconds. Use 0 for persistent. Default: 5000 */
  duration?: number;
  /** Unique ID for deduplication or dismissal */
  id?: string;
  /** Action button */
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

// ============================================
// Auth Service
// ============================================

export interface AuthUser {
  id: string;
  email?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
  address?: string | null;
  walletAddress?: string | null;
  roles: string[];
  permissions: Array<{ resource: string; action: string }> | string[];
}

export interface IAuthService {
  /** Get current authenticated user */
  getUser(): AuthUser | null;
  
  /** Get current auth token */
  getToken(): Promise<string>;
  
  /** Check if user has a specific role */
  hasRole(role: string): boolean;
  
  /** Check if user has a specific permission */
  hasPermission(resource: string, action: string): boolean;
  
  /** Check if user is authenticated */
  isAuthenticated(): boolean;
  
  /** Listen for auth state changes */
  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void;
}

// ============================================
// Storage Service
// ============================================

export interface StorageUploadOptions {
  /** Content type override */
  contentType?: string;
  /** Public or private access */
  access?: 'public' | 'private';
  /** Custom metadata */
  metadata?: Record<string, string>;
  /** Progress callback */
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
  /** Upload a file */
  upload(file: File | Blob, path: string, options?: StorageUploadOptions): Promise<StorageUploadResult>;
  
  /** Download a file */
  download(path: string): Promise<Blob>;
  
  /** Get a signed URL for direct access */
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
  
  /** Delete a file */
  delete(path: string): Promise<void>;
  
  /** List files with optional prefix */
  list(prefix?: string): Promise<StorageObject[]>;
  
  /** Check if storage is configured */
  isConfigured(): boolean;
}

// ============================================
// AI Service
// ============================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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

export interface IAIService {
  /** Generate a completion */
  complete(prompt: string, options?: AICompletionOptions): Promise<AICompletionResult>;
  
  /** Chat completion */
  chat(messages: ChatMessage[], options?: AICompletionOptions): Promise<AICompletionResult>;
  
  /** Generate embeddings */
  embed(text: string | string[]): Promise<number[][]>;
  
  /** Check if AI is configured */
  isConfigured(): boolean;
  
  /** Get available models */
  getModels(): Promise<string[]>;
}

// ============================================
// Email Service
// ============================================

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
  /** Send an email */
  send(
    to: EmailRecipient | EmailRecipient[],
    subject: string,
    body: string,
    options?: EmailOptions
  ): Promise<{ messageId: string }>;
  
  /** Send using a template */
  sendTemplate(
    to: EmailRecipient | EmailRecipient[],
    templateId: string,
    data: Record<string, unknown>,
    options?: EmailOptions
  ): Promise<{ messageId: string }>;
  
  /** Check if email is configured */
  isConfigured(): boolean;
}

// ============================================
// Event Bus Service
// ============================================

/**
 * Options for request/response pattern
 */
export interface EventRequestOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Number of retries on timeout (default: 0) */
  retries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
}

/**
 * Error thrown when a request times out or has no handler
 */
export class EventRequestError extends Error {
  constructor(
    message: string,
    public readonly event: string,
    public readonly code: 'TIMEOUT' | 'NO_HANDLER' | 'HANDLER_ERROR'
  ) {
    super(message);
    this.name = 'EventRequestError';
  }
}

/**
 * Common event types for type-safe event handling
 */
export interface PluginEventMap {
  // Shell events
  'shell:ready': { version: string };
  'shell:error': { message: string; code?: string };

  // Auth events
  'auth:login': { userId: string; email?: string };
  'auth:logout': { userId?: string };
  'auth:token-refresh': { expiresAt: number };

  // Theme events
  'theme:change': { mode: 'light' | 'dark' };

  // Navigation events
  'navigation:change': { path: string; params?: Record<string, string> };

  // Notification events
  'notification:show': { id: string; type: string; message: string };
  'notification:dismiss': { id: string };

  // Team events
  'team:change': { teamId: string | null; team?: unknown };
  'team:member-update': { memberId: string; role: string };

  // Tenant events
  'tenant:change': { pluginName: string; installation?: unknown };

  // Plugin lifecycle events
  'plugin:mount': { pluginName: string };
  'plugin:unmount': { pluginName: string };
  'plugin:error': { pluginName: string; error: string };

  // Custom events (plugins can extend)
  [key: string]: unknown;
}

export interface IEventBus {
  /** Emit an event (fire-and-forget) */
  emit<K extends keyof PluginEventMap>(event: K, data?: PluginEventMap[K]): void;
  emit<T = unknown>(event: string, data?: T): void;

  /** Subscribe to an event */
  on<K extends keyof PluginEventMap>(event: K, callback: (data: PluginEventMap[K]) => void): () => void;
  on<T = unknown>(event: string, callback: (data: T) => void): () => void;

  /** Unsubscribe from an event */
  off<K extends keyof PluginEventMap>(event: K, callback: (data: PluginEventMap[K]) => void): void;
  off<T = unknown>(event: string, callback: (data: T) => void): void;

  /** Subscribe to an event once */
  once<K extends keyof PluginEventMap>(event: K, callback: (data: PluginEventMap[K]) => void): () => void;
  once<T = unknown>(event: string, callback: (data: T) => void): () => void;

  /**
   * Request/response pattern for plugin-to-plugin communication.
   * Sends a request event and waits for a response from a handler.
   *
   * @param event - The event name (handler should register with same name)
   * @param data - The request payload
   * @param options - Request options (timeout, retries)
   * @returns A promise that resolves with the response data
   * @throws EventRequestError if timeout or no handler
   *
   * @example
   * ```typescript
   * // Plugin A requests data from Plugin B
   * const result = await eventBus.request<{ id: string }, UserData>(
   *   'user:get-profile',
   *   { id: '123' },
   *   { timeout: 3000 }
   * );
   * ```
   */
  request<TReq = unknown, TRes = unknown>(
    event: string,
    data?: TReq,
    options?: EventRequestOptions
  ): Promise<TRes>;

  /**
   * Register a handler for request/response events.
   * The handler receives the request data and returns a response.
   *
   * @param event - The event name to handle
   * @param handler - Async function that processes the request and returns a response
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * // Plugin B handles requests from other plugins
   * const unsubscribe = eventBus.handleRequest<{ id: string }, UserData>(
   *   'user:get-profile',
   *   async (data) => {
   *     const user = await fetchUser(data.id);
   *     return user;
   *   }
   * );
   *
   * // Cleanup when plugin unmounts
   * return () => unsubscribe();
   * ```
   */
  handleRequest<TReq = unknown, TRes = unknown>(
    event: string,
    handler: (data: TReq) => TRes | Promise<TRes>
  ): () => void;
}

// ============================================
// Logger Service
// ============================================

export interface LogMeta {
  [key: string]: unknown;
}

export interface ILoggerService {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, error?: Error, meta?: LogMeta): void;
  
  /** Create a child logger with additional context */
  child(context: LogMeta): ILoggerService;
}

// ============================================
// Theme Service
// ============================================

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
  /** Get current theme mode */
  mode: 'light' | 'dark';
  
  /** Get theme colors */
  colors: ThemeColors;
  
  /** Toggle theme mode */
  toggle(): void;
  
  /** Set specific mode */
  setMode(mode: 'light' | 'dark'): void;
  
  /** Listen for theme changes */
  onChange(callback: (mode: 'light' | 'dark') => void): () => void;
}

// ============================================
// Permission Service
// ============================================

export interface Permission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'admin' | '*';
  scope?: string;
}

export interface IPermissionService {
  /** Check if user can perform action on resource */
  can(resource: string, action: string): boolean;
  
  /** Get all permissions for current user */
  getPermissions(): Permission[];
  
  /** Require permission (throws if not authorized) */
  require(resource: string, action: string): void;
}

// ============================================
// Integration Service (Facade)
// ============================================

export interface IIntegrationService {
  /** Get AI service */
  ai: IAIService;
  
  /** Get storage service */
  storage: IStorageService;
  
  /** Get email service */
  email: IEmailService;
  
  /** Check if a specific integration is configured */
  isConfigured(type: 'ai' | 'storage' | 'email'): boolean;
  
  /** Get all available integrations */
  getAvailable(): Array<{ type: string; configured: boolean }>;
}

// ============================================
// Tenant Service (Multi-Tenant Plugin Support)
// ============================================

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
  /** List all installations for the current user */
  listInstallations(): Promise<TenantInstallation[]>;
  
  /** Get a specific installation by ID */
  getInstallation(installId: string): Promise<TenantInstallation | null>;
  
  /** Get installation by plugin name */
  getInstallationByPlugin(pluginName: string): Promise<TenantInstallation | null>;
  
  /** Install a plugin for the current user */
  install(packageName: string, config?: Record<string, unknown>): Promise<{
    installation: TenantInstallation;
    isFirstInstall: boolean;
  }>;
  
  /** Uninstall a plugin for the current user */
  uninstall(installId: string): Promise<{
    success: boolean;
    shouldCleanup: boolean;
  }>;
  
  /** Update installation preferences */
  updatePreferences(installId: string, preferences: {
    enabled?: boolean;
    order?: number;
    pinned?: boolean;
  }): Promise<TenantInstallation>;
  
  /** Get tenant configuration for a plugin */
  getConfig(installId: string): Promise<TenantConfig>;
  
  /** Update tenant configuration for a plugin */
  updateConfig(installId: string, config: Partial<TenantConfig>): Promise<TenantConfig>;
  
  /** Check if user has a plugin installed */
  hasPlugin(pluginName: string): Promise<boolean>;
}

/**
 * Tenant context state for detecting tenant installation context.
 * Similar to TeamContext but for per-user plugin installations.
 */
export interface ITenantContext {
  /** Current tenant installation for the active plugin */
  currentInstallation: TenantInstallation | null;
  /** Whether we are in a tenant installation context */
  isTenantContext: boolean;
  /** Set the current tenant installation (by plugin name) */
  setCurrentPlugin: (pluginName: string | null) => Promise<void>;
  /** Refresh the current installation */
  refreshInstallation: () => Promise<void>;
  /** Loading state */
  isLoading: boolean;
}

// ============================================
// Team/Organization Service
// ============================================

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
  /** Current team (null if in personal workspace) */
  currentTeam: Team | null;
  
  /** Current user's team membership */
  currentMember: TeamMember | null;
  
  /** Switch to a different team or personal workspace */
  setCurrentTeam: (teamId: string | null) => Promise<void>;
  
  /** Check if we're in a team context */
  isTeamContext: boolean;
  
  /** Current user's role in the team */
  memberRole: string | null;
  
  /** Check if current user has a specific team permission */
  hasTeamPermission: (permission: string) => boolean;
  
  /** Refresh team data */
  refreshTeam: () => Promise<void>;
}

// ============================================
// API Client Service
// ============================================

export interface IApiClient {
  /** Make a GET request */
  get<T = unknown>(url: string, options?: RequestInit): Promise<T>;
  
  /** Make a POST request */
  post<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  
  /** Make a PUT request */
  put<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  
  /** Make a PATCH request */
  patch<T = unknown>(url: string, body?: unknown, options?: RequestInit): Promise<T>;
  
  /** Make a DELETE request */
  delete<T = unknown>(url: string, options?: RequestInit): Promise<T>;
}

// ============================================
// Plugin Config Context
// ============================================

export interface PluginConfigState<T = Record<string, unknown>> {
  config: T;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface TeamPluginConfigState<T = Record<string, unknown>> {
  sharedConfig: T;
  personalConfig: T;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface PluginConfigContext {
  [pluginName: string]: {
    personal?: PluginConfigState;
    team?: TeamPluginConfigState;
  };
}

// ============================================
// Capability Service (Phase 3)
// ============================================

/**
 * Available shell capabilities that plugins can check
 */
export type ShellCapability = 
  | 'ai'            // AI/ML services (OpenAI, etc.)
  | 'storage'       // File storage (S3, etc.)
  | 'email'         // Email sending (SendGrid, etc.)
  | 'payments'      // Payment processing
  | 'notifications' // Push notifications
  | 'teams'         // Team/organization support
  | 'tenants'       // Multi-tenant support
  | 'websocket'     // Real-time websocket support
  | 'analytics'     // Usage analytics
  | 'search'        // Full-text search
  | string;         // Custom capabilities

/**
 * Capability status information
 */
export interface CapabilityInfo {
  available: boolean;
  configured: boolean;
  version?: string;
  provider?: string;
}

/**
 * Capability service for checking available shell features
 */
export interface ICapabilityService {
  /**
   * Check if a capability is available
   * @param capability The capability to check
   * @returns Whether the capability is available and configured
   */
  has(capability: ShellCapability): boolean;
  
  /**
   * Get detailed info about a capability
   * @param capability The capability to check
   * @returns Capability status information
   */
  info(capability: ShellCapability): CapabilityInfo;
  
  /**
   * Get all available capabilities
   * @returns Map of capability names to their info
   */
  getAll(): Record<string, CapabilityInfo>;
  
  /**
   * Check if multiple capabilities are all available
   * @param capabilities Array of capabilities to check
   * @returns Whether all capabilities are available
   */
  hasAll(capabilities: ShellCapability[]): boolean;
  
  /**
   * Check if any of the capabilities are available
   * @param capabilities Array of capabilities to check
   * @returns Whether any capability is available
   */
  hasAny(capabilities: ShellCapability[]): boolean;
}

// ============================================
// Shell Context
// ============================================

export interface ShellContext {
  /** Auth service */
  auth: IAuthService;
  
  /** Navigation */
  navigate: (path: string) => void;
  
  /** Event bus for inter-plugin communication */
  eventBus: IEventBus;
  
  /** Theme service */
  theme: IThemeService;
  
  /** Notification service */
  notifications: INotificationService;
  
  /** Integration services */
  integrations: IIntegrationService;
  
  /** Logger service */
  logger: ILoggerService;
  
  /** Permission service */
  permissions: IPermissionService;
  
  /** Tenant service (optional for backward compatibility) */
  tenant?: ITenantService;
  
  /** Team context (optional for backward compatibility) */
  team?: ITeamContext;
  
  /** API client for making authenticated requests */
  api?: IApiClient;
  
  /** Plugin-specific configuration context */
  pluginConfig?: PluginConfigContext;
  
  /** 
   * Capability service for checking available shell features
   * Phase 3: Allows plugins to gracefully degrade if features are unavailable
   */
  capabilities?: ICapabilityService;
  
  /** Shell version */
  version: string;
}
