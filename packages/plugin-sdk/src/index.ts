/**
 * NAAP Plugin SDK
 * 
 * SDK for developing NAAP plugins with full lifecycle support:
 * - Scaffold new plugins from templates
 * - Hot-reload development against live shell
 * - Automated testing
 * - Build and package for distribution
 * - Publish to plugin registry
 * - Version management and deprecation
 */

// Types
export * from './types/index.js';

// Utilities
export * from './utils/index.js';

// React Hooks
export * from './hooks/index.js';

// React Components
export * from './components/index.js';

// Re-export commonly used types at top level
export type {
  PluginManifest,
  PluginTemplate,
  PluginCategory,
  PluginStatus,
} from './types/manifest.js';

export type {
  ShellContext,
  PluginModule,
  PluginMountFn,
  PluginInitFn,
  PluginLifecyclePhase,
  PluginMountResult,
} from './types/context.js';

export type {
  Integration,
  StorageIntegration,
  AIIntegration,
  EmailIntegration,
  PaymentIntegration,
} from './types/integrations.js';

// Service interfaces
export type {
  INotificationService,
  IAuthService,
  IStorageService,
  IAIService,
  IEmailService,
  IEventBus,
  ILoggerService,
  IThemeService,
  IPermissionService,
  IIntegrationService,
  IApiClient,
  ITenantService,
  ITeamContext,
  AuthUser,
  NotificationOptions,
  StorageObject,
  StorageUploadResult,
  ChatMessage,
  AICompletionResult,
  Permission,
  PluginConfigContext,
} from './types/services.js';

export {
  validateManifest,
  validatePluginName,
  validateVersion,
  createDefaultManifest,
} from './utils/validation.js';

export {
  createApiClient,
  createShellApiClient,
  createIntegrationClient,
  getPluginBackendUrl,
  createPluginApiClient,
  type ApiClient,
  type ApiResponse,
  type ApiError,
  type ApiClientOptions,
  type PluginBackendUrlOptions,
} from './utils/api.js';

export {
  MigrationRegistry,
  createMigrationName,
  runPluginMigrations,
  getPluginMigrationStatus,
  type MigrationDefinition,
} from './utils/migration.js';

// Port Configuration (Single Source of Truth)
export {
  PLUGIN_PORTS,
  DEFAULT_PORT,
  getPluginPort,
  isKnownPlugin,
  getRegisteredPlugins,
  validatePort,
  assertCorrectPort,
  API_PATHS,
  getApiPath,
  type PluginName,
  type PortValidationResult,
} from './config/ports.js';

export {
  createPluginMount,
  createPlugin,
  enablePluginHMR,
  type CreatePluginMountOptions,
  type PluginMetadata,
  type PluginManifestExport,
} from './utils/mount.js';

// API Hooks (Phase 4)
export {
  usePluginApi,
  type UsePluginApiOptions,
  type PluginApiClient,
} from './hooks/usePluginApi.js';

// Event Hooks (Phase 5)
export {
  usePluginEvent,
  useEventRequest,
  useEventHandler,
  type UsePluginEventOptions,
  type UsePluginEventResult,
} from './hooks/usePluginEvent.js';

// Event Bus Types (Phase 5)
export {
  EventRequestError,
  type EventRequestOptions,
  type PluginEventMap,
} from './types/services.js';

// SDK version
export const SDK_VERSION = '1.0.0';
