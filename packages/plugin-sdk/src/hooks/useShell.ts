/**
 * useShell Hooks
 * 
 * Provides access to the shell context and services within plugin components.
 * 
 * Usage in plugins:
 * 1. Wrap your plugin's React tree with ShellProvider, passing the context from mount()
 * 2. Use hooks like useShell(), useAuth(), useNotify() in any component
 * 
 * Example:
 * ```tsx
 * export function mount(container: HTMLElement, context: ShellContext) {
 *   const root = ReactDOM.createRoot(container);
 *   root.render(
 *     <ShellProvider value={context}>
 *       <App />
 *     </ShellProvider>
 *   );
 *   return () => root.unmount();
 * }
 * ```
 */

import { createContext, useContext } from 'react';
import type { ShellContext } from '../types/context.js';
import type {
  INotificationService,
  IAuthService,
  IEventBus,
  IThemeService,
  ILoggerService,
  IPermissionService,
  IIntegrationService,
  IAIService,
  IStorageService,
  IEmailService,
  ICapabilityService,
  ShellCapability,
  CapabilityInfo,
} from '../types/services.js';

// ============================================
// Shell Context
// ============================================

const ShellContextInstance = createContext<ShellContext | null>(null);

/**
 * Shell context provider for plugins.
 * Wrap your plugin's React tree with this provider, passing the context from mount().
 * 
 * @example
 * ```tsx
 * import { ShellProvider } from '@naap/plugin-sdk';
 * 
 * export function mount(container: HTMLElement, context: ShellContext) {
 *   const root = ReactDOM.createRoot(container);
 *   root.render(
 *     <ShellProvider value={context}>
 *       <App />
 *     </ShellProvider>
 *   );
 *   return () => root.unmount();
 * }
 * ```
 */
export const ShellProvider = ShellContextInstance.Provider;

/**
 * Hook to access the full shell context.
 * Must be used within a ShellProvider.
 */
export function useShell(): ShellContext {
  const context = useContext(ShellContextInstance);
  if (!context) {
    throw new Error(
      'useShell must be used within a ShellProvider. ' +
      'Wrap your plugin component tree with <ShellProvider value={context}> ' +
      'where context is the ShellContext passed to your mount() function.'
    );
  }
  return context;
}

// ============================================
// Service Hooks
// ============================================

/**
 * Hook to access the auth service.
 * Provides methods like getUser(), getToken(), hasRole(), hasPermission().
 * 
 * This is the preferred way to access authentication in plugins.
 * 
 * @returns The auth service interface
 * 
 * @example
 * ```tsx
 * function UserProfile() {
 *   const auth = useAuthService();
 *   const user = auth.getUser();
 *   
 *   if (!auth.isAuthenticated()) {
 *     return <LoginPrompt />;
 *   }
 *   
 *   return <div>Welcome, {user?.displayName}</div>;
 * }
 * ```
 */
export function useAuthService(): IAuthService {
  const shell = useShell();
  return shell.auth;
}

/**
 * Hook to access the auth service.
 * 
 * @deprecated Use `useAuthService` instead to avoid naming conflicts with shell's AuthContext.
 * This hook will continue to work but shows a deprecation warning in development.
 * 
 * Migration guide:
 * ```diff
 * - import { useAuth } from '@naap/plugin-sdk';
 * + import { useAuthService } from '@naap/plugin-sdk';
 * 
 * function MyComponent() {
 * -   const auth = useAuth();
 * +   const auth = useAuthService();
 * }
 * ```
 */
export function useAuth(): IAuthService {
  // Show deprecation warning in development (once per session)
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    const key = '__naap_useAuth_deprecated_warning__';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, 'true');
      console.warn(
        '[NAAP SDK] useAuth() is deprecated. Use useAuthService() instead.\n' +
        'See migration guide: https://docs.naap.io/sdk/migration#useauth'
      );
    }
  }
  
  return useAuthService();
}

/**
 * Hook to access the notification service.
 * Provides methods like success(), error(), warning(), info().
 */
export function useNotify(): INotificationService {
  const shell = useShell();
  return shell.notifications;
}

/**
 * Hook to access the event bus service.
 * Provides methods like emit(), on(), off() for inter-plugin communication.
 */
export function useEvents(): IEventBus {
  const shell = useShell();
  return shell.eventBus;
}

/**
 * Hook to access the theme service.
 * Provides current theme mode and colors.
 */
export function useThemeService(): IThemeService {
  const shell = useShell();
  return shell.theme;
}

/**
 * Hook to access the logger service.
 * Optionally pass a context name to create a child logger.
 */
export function useLogger(context?: string): ILoggerService {
  const shell = useShell();
  if (context) {
    return shell.logger.child({ context });
  }
  return shell.logger;
}

/**
 * Hook to access the permission service.
 * Provides methods like can(), hasRole().
 */
export function usePermissions(): IPermissionService {
  const shell = useShell();
  return shell.permissions;
}

/**
 * Hook to access integration services.
 * Provides access to AI, storage, email, and other integrations.
 */
export function useIntegrations(): IIntegrationService {
  const shell = useShell();
  return shell.integrations;
}

/**
 * Hook to check a specific permission.
 * @param resource - The resource to check (e.g., 'plugin', 'team')
 * @param action - The action to check (e.g., 'read', 'write', 'admin')
 */
export function usePermission(resource: string, action: string): boolean {
  const permissions = usePermissions();
  return permissions.can(resource, action);
}

/**
 * Hook to access the AI service.
 * 
 * Provides methods for AI completion, chat, and embeddings.
 * 
 * @returns The AI service interface
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const ai = useAI();
 *   
 *   const handleGenerate = async () => {
 *     const result = await ai.complete('Write a haiku about coding');
 *     console.log(result.content);
 *   };
 * }
 * ```
 */
export function useAI(): IAIService {
  const integrations = useIntegrations();
  return integrations.ai;
}

/**
 * Hook to access the storage service.
 * 
 * Provides methods for file upload, download, and management.
 * 
 * @returns The storage service interface
 * 
 * @example
 * ```tsx
 * function FileUploader() {
 *   const storage = useStorage();
 *   
 *   const handleUpload = async (file: File) => {
 *     const result = await storage.upload(file, `uploads/${file.name}`);
 *     console.log('Uploaded to:', result.url);
 *   };
 * }
 * ```
 */
export function useStorage(): IStorageService {
  const integrations = useIntegrations();
  return integrations.storage;
}

/**
 * Hook to access the email service.
 * 
 * Provides methods for sending emails and email templates.
 * 
 * @returns The email service interface
 * 
 * @example
 * ```tsx
 * function NotificationSender() {
 *   const email = useEmail();
 *   
 *   const sendWelcome = async (userEmail: string) => {
 *     await email.send(
 *       { email: userEmail },
 *       'Welcome!',
 *       'Thanks for joining our platform.'
 *     );
 *   };
 * }
 * ```
 */
export function useEmail(): IEmailService {
  const integrations = useIntegrations();
  return integrations.email;
}

/**
 * Hook to get the navigation function.
 */
export function useNavigate(): (path: string) => void {
  const shell = useShell();
  return shell.navigate;
}

// ============================================
// Capability Hooks (Phase 3)
// ============================================

/**
 * Default capability service for when shell doesn't provide one
 * Returns false for all capabilities (safe fallback)
 */
const defaultCapabilityService: ICapabilityService = {
  has: () => false,
  info: () => ({ available: false, configured: false }),
  getAll: () => ({}),
  hasAll: () => false,
  hasAny: () => false,
};

/**
 * Hook to access the capability service.
 * Allows plugins to check if shell features are available before using them.
 * 
 * @returns The capability service interface
 * 
 * @example
 * ```tsx
 * function AIFeature() {
 *   const capabilities = useCapabilities();
 *   
 *   if (!capabilities.has('ai')) {
 *     return <p>AI features not available</p>;
 *   }
 *   
 *   return <AIComponent />;
 * }
 * ```
 */
export function useCapabilities(): ICapabilityService {
  const shell = useShell();
  return shell.capabilities || defaultCapabilityService;
}

/**
 * Hook to check if a specific capability is available.
 * Shorthand for useCapabilities().has(capability).
 * 
 * @param capability The capability to check
 * @returns Whether the capability is available
 * 
 * @example
 * ```tsx
 * function StorageUploader() {
 *   const hasStorage = useCapability('storage');
 *   
 *   if (!hasStorage) {
 *     return <p>File storage not configured</p>;
 *   }
 *   
 *   return <FileUpload />;
 * }
 * ```
 */
export function useCapability(capability: ShellCapability): boolean {
  const capabilities = useCapabilities();
  return capabilities.has(capability);
}

/**
 * Hook to get detailed info about a capability.
 * 
 * @param capability The capability to check
 * @returns Capability info including availability, configuration, and provider
 * 
 * @example
 * ```tsx
 * function AIInfo() {
 *   const aiInfo = useCapabilityInfo('ai');
 *   
 *   if (aiInfo.available && aiInfo.provider) {
 *     return <p>AI powered by {aiInfo.provider}</p>;
 *   }
 *   
 *   return <p>AI not configured</p>;
 * }
 * ```
 */
export function useCapabilityInfo(capability: ShellCapability): CapabilityInfo {
  const capabilities = useCapabilities();
  return capabilities.info(capability);
}

// ============================================
// Backward Compatibility Aliases
// These will be removed in a future version.
// ============================================

/**
 * @deprecated Use ShellProvider instead
 */
export const ShellProviderV2 = ShellProvider;

/**
 * @deprecated Use useShell instead
 */
export const useShellV2 = useShell;
