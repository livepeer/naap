/**
 * React Hooks for Plugin Development
 * 
 * These hooks provide access to shell services within plugin components.
 * Wrap your plugin's React tree with ShellProvider to enable these hooks.
 */

// Shell Context & Provider
export {
  ShellProvider,
  useShell,
  // Backward compatibility aliases (deprecated)
  ShellProviderV2,
  useShellV2,
} from './useShell.js';

// Service Hooks
export {
  useAuthService,  // Preferred - use this instead of useAuth
  useAuth,         // Deprecated - kept for backward compatibility
  useNotify,
  useEvents,
  useThemeService,
  useLogger,
  usePermissions,
  useIntegrations,
  usePermission,
  useAI,
  useStorage,
  useEmail,
  useNavigate,
  // Phase 3: Capability checks
  useCapabilities,
  useCapability,
  useCapabilityInfo,
} from './useShell.js';

// API Client Hooks
export {
  useApiClient,
  useAuthHeaders,
  type UseApiClientOptions,
  type EnhancedApiClient,
} from './useApiClient.js';

// Plugin API Hook (Phase 4 - simplified plugin-to-backend communication)
export {
  usePluginApi,
  type UsePluginApiOptions,
  type PluginApiClient,
} from './usePluginApi.js';

// Plugin Event Hook (Phase 5 - event bus with request/response pattern)
export {
  usePluginEvent,
  useEventRequest,
  useEventHandler,
  type UsePluginEventOptions,
  type UsePluginEventResult,
} from './usePluginEvent.js';

// User Hooks
export {
  useUser,
  useIsAuthenticated,
  useHasRole as useUserHasRole,
  useHasPermission as useUserHasPermission,
} from './useUser.js';

// Error Handling Hooks
export {
  useError,
  useErrorHandler,
  type EnhancedError,
  type UseErrorResult,
  type ErrorHandlingOptions,
} from './useError.js';

// Plugin Configuration Hooks
export {
  usePluginConfig,
  useConfigValue,
  type PluginConfigOptions,
  type PluginConfigResult,
} from './usePluginConfig.js';

// Integration Hooks
export {
  useIntegration,
  useStorageIntegration,
  useAIIntegration,
  useEmailIntegration,
  usePaymentIntegration,
  useAvailableIntegrations,
  type UseIntegrationOptions,
  type UseIntegrationResult,
} from './useIntegration.js';

// Plugin Admin Hooks
export {
  usePluginAdmin,
  type PluginUser,
  type PluginRole,
  type UsePluginAdminResult,
} from './usePluginAdmin.js';

// Tenant/Multi-Tenant Hooks
export {
  useTenant,
  useTenantContext,  // Tenant context state for detecting tenant installation context
  usePluginInstallation,
  usePluginTenantConfig,
  usePluginPreferences,
  useHasPlugin,
  useUserPlugins,
  usePluginActions,
} from './useTenant.js';

// Team/Organization Hooks
export {
  useTeam,
  useCurrentTeam,
  useIsTeamContext,
  useTeamRole,
  useTeamPermission,
  useIsTeamOwner,
  useIsTeamAdmin,
  useCanManageMembers,
  useCanInstallPlugins,
  useCanConfigurePlugins,
  useTenantId,
  useTeamPluginConfig,
  mergeConfigs,
  // Note: Team and TeamMember types are exported from types/services.ts
  type TeamContext,
  type TeamPluginConfigResult,
} from './useTeam.js';

// Overlay Hook
export {
  useOverlay,
  type OverlayOptions,
  type Overlay,
} from './useOverlay.js';

// Keyboard Shortcut Hook
export {
  useKeyboardShortcut,
  type KeyboardShortcut,
} from './useKeyboardShortcut.js';

// Pipeline Hooks (Phase 5)
export {
  usePipelines,
  usePipeline,
  useLLM,
  useLiveSession,
  useAsyncJob,
  usePipelineQuota,
  usePipelineFlags,
} from './usePipeline.js';

// WebRTC Hooks — WHIP/WHEP/Trickle (Phase 5c)
export {
  useWHIPPublisher,
  useWHEPPlayer,
  useTrickleControl,
  type UseWHIPPublisherOptions,
  type UseWHEPPlayerOptions,
} from './useWebRTC.js';

// Livepeer Hooks (Phase 4f)
export {
  useOrchestrators,
  useOrchestrator,
  useDelegator,
  useStakingActions,
  useGatewayDeposit,
  useGatewayFunding,
  useGatewayPricing,
  useProtocolParameters,
  useCurrentRound,
  useLivepeerNode,
  useLivepeerNodes,
  useLivepeerAI,
  useLiveVideoToVideo,
  useNetworkStats,
} from './useLivepeer.js';

// WebSocket Hook (Phase 2e)
export {
  useWebSocket,
  type UseWebSocketOptions,
  type UseWebSocketResult,
} from './useWebSocket.js';

// Data Fetching Hooks (Phase 1d)
export {
  useQuery,
  useMutation,
  invalidateQueries,
  clearQueryCache,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
} from './useQuery.js';
