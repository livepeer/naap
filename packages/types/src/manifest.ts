// WorkflowManifest - Contract for MFE workflow modules
// Each workflow must expose this interface for the shell to load and mount it

import type { Emitter } from 'mitt';
import type { UserContext, ThemeTokens } from './index';

/**
 * Event types that can be emitted/received through the shell event bus
 */
export type ShellEvents = {
  'auth:login': { address: string };
  'auth:logout': void;
  'theme:change': { isDark: boolean };
  'notification:show': { message: string; type: 'info' | 'success' | 'error' };
  'workflow:loaded': { name: string };
  'workflow:error': { name: string; error: string };
  'plugin:installed': { name: string };
  'plugin:uninstalled': { name: string };
  'team:change': { teamId: string | null; teamName?: string };
  'team:created': { team: { id: string; name: string } };
};

/**
 * Team context for plugins to know current workspace
 */
export interface TeamContext {
  teamId: string | null;
  teamName: string | null;
  isTeamContext: boolean;
}

/**
 * Legacy context provided by the shell to workflows.
 * @deprecated Use ShellContext from @naap/plugin-sdk instead.
 * This interface is kept for backward compatibility with MFE workflows.
 */
export interface LegacyWorkflowContext {
  /**
   * Get the current auth token (async to support refresh)
   */
  authToken: () => Promise<string>;

  /**
   * Get the current user context
   */
  user: () => UserContext;

  /**
   * Get the current team context (null if in personal workspace)
   */
  team: () => TeamContext;

  /**
   * Navigate to a path using the shell's router
   */
  navigate: (path: string) => void;

  /**
   * Event bus for cross-workflow communication
   * Uses Mitt for lightweight pub/sub
   */
  eventBus: Emitter<ShellEvents>;

  /**
   * Current theme tokens for consistent styling
   */
  theme: ThemeTokens;

  /**
   * Get headers for authenticated API requests
   * Includes Authorization token and CSRF token
   * Plugins should use this instead of managing tokens directly
   */
  getApiHeaders: () => Record<string, string>;

  /**
   * Base URL for the backend API
   */
  apiBaseUrl: string;
}

/**
 * @deprecated Use LegacyWorkflowContext instead. ShellContext is now defined in @naap/plugin-sdk.
 */
export type ShellContext = LegacyWorkflowContext;

/**
 * Manifest that each workflow module must export
 */
export interface WorkflowManifest {
  /**
   * Unique name of the workflow (e.g., 'gateway-manager')
   */
  name: string;
  
  /**
   * Semantic version of the workflow
   */
  version: string;
  
  /**
   * Routes this workflow handles (relative to base path)
   */
  routes: string[];
  
  /**
   * Mount the workflow into a DOM container
   * @param container - The DOM element to render into
   * @param context - Shell context with auth, navigation, events, theme
   * @returns Optional cleanup function called on unmount
   */
  mount(container: HTMLElement, context: ShellContext): (() => void) | void;
  
  /**
   * Optional unmount function (alternative to returning from mount)
   */
  unmount?(): void;
}

/**
 * Helper type for module export structure
 */
export interface WorkflowModule {
  default: WorkflowManifest;
  manifest: WorkflowManifest;
  mount: WorkflowManifest['mount'];
}
