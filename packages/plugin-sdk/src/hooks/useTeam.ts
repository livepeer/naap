/**
 * Team Hooks for Plugin SDK
 * 
 * Provides hooks for plugins to access team context and permissions.
 * 
 * Phase 2.3: Updated to handle event-based team data from ShellContext.
 * Plugins get real-time team updates via EventBus without managing state themselves.
 */

import { useState, useEffect } from 'react';
import { useShell } from './useShell.js';
import type { Team, TeamMember, ITeamContext } from '../types/services.js';

// Re-export types for convenience
export type { Team, TeamMember };

/**
 * Team context returned by useTeam hook
 */
export type TeamContext = ITeamContext & {
  currentTeam: Team | null;
  currentMember: TeamMember | null;
};

/**
 * Hook to access the full team context
 * Phase 2.3: Now manages state internally by listening to team:change events
 */
export function useTeam(): TeamContext | null {
  const shell = useShell();
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [_isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<{ teamId: string; message: string } | null>(null);

  // Listen to team change events from ShellContext
  useEffect(() => {
    const handleTeamChange = (payload: { teamId: string | null; team?: Team; member?: TeamMember }) => {
      setCurrentTeam(payload.team || null);
      setCurrentMember(payload.member || null);
      setError(null);
      setIsLoading(false);
    };

    const handleTeamError = (payload: { teamId: string; error: string }) => {
      setError({ teamId: payload.teamId, message: payload.error });
      setCurrentTeam(null);
      setCurrentMember(null);
      setIsLoading(false);
    };

    shell.eventBus.on('team:change', handleTeamChange);
    shell.eventBus.on('team:error', handleTeamError);

    return () => {
      shell.eventBus.off('team:change', handleTeamChange);
      shell.eventBus.off('team:error', handleTeamError);
    };
  }, [shell.eventBus]);

  if (!shell.team) {
    return null;
  }

  // Return enhanced team context with event-based state
  // Conform to ITeamContext interface from SDK types
  return {
    currentTeam,
    currentMember,
    setCurrentTeam: shell.team.setCurrentTeam,
    isTeamContext: currentTeam !== null,
    memberRole: currentMember?.role || null,
    hasTeamPermission: (permission: string): boolean => {
      if (!currentMember) return false;
      // Permission check logic delegated to ShellContext
      return shell.team?.hasTeamPermission(permission) || false;
    },
    refreshTeam: shell.team.refreshTeam,
  };
}

/**
 * Hook to get the current team
 * Phase 2.3: Now returns real-time team data from events
 */
export function useCurrentTeam(): Team | null {
  const team = useTeam();
  return team?.currentTeam || null;
}

/**
 * Hook to check if we're in a team context
 * Phase 2.3: Reflects real-time team state
 */
export function useIsTeamContext(): boolean {
  const team = useTeam();
  return team?.currentTeam !== null;
}

/**
 * Hook to get the current user's team role
 */
export function useTeamRole(): string | null {
  const team = useTeam();
  return team?.memberRole || null;
}

/**
 * Hook to check team permission
 */
export function useTeamPermission(permission: string): boolean {
  const team = useTeam();
  return team?.hasTeamPermission(permission) || false;
}

/**
 * Hook to check if user is team owner
 */
export function useIsTeamOwner(): boolean {
  const role = useTeamRole();
  return role === 'owner';
}

/**
 * Hook to check if user is team admin or owner
 */
export function useIsTeamAdmin(): boolean {
  const role = useTeamRole();
  return role === 'owner' || role === 'admin';
}

/**
 * Hook to check if user can manage members
 */
export function useCanManageMembers(): boolean {
  return useTeamPermission('members.manage');
}

/**
 * Hook to check if user can install plugins
 */
export function useCanInstallPlugins(): boolean {
  return useTeamPermission('plugins.install');
}

/**
 * Hook to check if user can configure plugins
 */
export function useCanConfigurePlugins(): boolean {
  return useTeamPermission('plugins.configure');
}

/**
 * Hook to get team-aware tenant ID
 * Returns team ID if in team context, otherwise returns user ID
 */
export function useTenantId(): string | null {
  const shell = useShell();
  const team = useTeam();

  if (team?.isTeamContext && team.currentTeam) {
    return team.currentTeam.id;
  }

  // Fall back to user ID for personal workspace
  const user = shell.auth.getUser();
  return user?.id || null;
}

// ============================================
// Team Plugin Config Hooks
// ============================================

export interface TeamPluginConfigResult<T = Record<string, unknown>> {
  /** Shared config set by team owner */
  sharedConfig: T;
  /** Personal config overrides */
  personalConfig: T;
  /** Merged config (personal overrides shared) */
  mergedConfig: T;
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Update personal config */
  updatePersonalConfig: (config: Partial<T>) => Promise<void>;
  /** Refresh config */
  refresh: () => Promise<void>;
}

/**
 * Merge shared and personal configs
 * Personal config overrides shared config
 * null values in personal config explicitly disable the shared value
 */
export function mergeConfigs<T = Record<string, unknown>>(
  shared: T,
  personal: Partial<T>
): T {
  if (!shared || typeof shared !== 'object') {
    return shared;
  }

  const result = { ...shared } as any;
  
  for (const key in personal) {
    if (Object.prototype.hasOwnProperty.call(personal, key)) {
      const personalValue = personal[key];
      if (personalValue === null) {
        // Explicitly disabled - remove from result
        delete result[key];
      } else if (personalValue !== undefined) {
        // Override with personal value
        result[key] = personalValue;
      }
      // undefined = use shared value (don't override)
    }
  }
  
  return result as T;
}

/**
 * Hook to get plugin config in team context
 * Automatically merges shared and personal config
 *
 * Uses the shell context to fetch and manage configuration.
 * Plugins should use this hook when they need team-scoped configuration.
 */
export function useTeamPluginConfig<T = Record<string, unknown>>(
  pluginName: string
): TeamPluginConfigResult<T> {
  const shell = useShell();
  const team = useTeam();

  // Access plugin-specific context from shell
  const pluginContext = shell.pluginConfig?.[pluginName];

  // If in team context, use team plugin config
  if (team?.isTeamContext && team.currentTeam) {
    // Team-aware config from shell's plugin context
    const teamConfig = pluginContext?.team;

    if (teamConfig) {
      const sharedConfig = (teamConfig.sharedConfig || {}) as T;
      const personalConfig = (teamConfig.personalConfig || {}) as T;

      return {
        sharedConfig,
        personalConfig,
        mergedConfig: mergeConfigs(sharedConfig, personalConfig),
        loading: teamConfig.loading || false,
        error: teamConfig.error || null,
        updatePersonalConfig: async (config: Partial<T>) => {
          // Call shell API to update personal config
          if (!shell.api) {
            throw new Error('Shell API not available');
          }

          await shell.api.post(
            `/api/v1/teams/${team.currentTeam!.id}/plugins/${pluginName}/config/personal`,
            config
          );

          // Trigger refresh
          if (teamConfig.refresh) {
            await teamConfig.refresh();
          }
        },
        refresh: async () => {
          if (teamConfig.refresh) {
            await teamConfig.refresh();
          }
        },
      };
    }
  }

  // Fall back to non-team config (personal workspace)
  const personalConfig = pluginContext?.personal;

  if (personalConfig) {
    return {
      sharedConfig: {} as T,
      personalConfig: (personalConfig.config || {}) as T,
      mergedConfig: (personalConfig.config || {}) as T,
      loading: personalConfig.loading || false,
      error: personalConfig.error || null,
      updatePersonalConfig: async (config: Partial<T>) => {
        if (!shell.api) {
          throw new Error('Shell API not available');
        }

        await shell.api.post(`/api/v1/base/plugins/${pluginName}/config`, config);

        if (personalConfig.refresh) {
          await personalConfig.refresh();
        }
      },
      refresh: async () => {
        if (personalConfig.refresh) {
          await personalConfig.refresh();
        }
      },
    };
  }

  // Default empty state when shell context isn't ready
  return {
    sharedConfig: {} as T,
    personalConfig: {} as T,
    mergedConfig: {} as T,
    loading: true,
    error: null,
    updatePersonalConfig: async () => {
      console.warn('useTeamPluginConfig: Shell context not ready');
    },
    refresh: async () => {
      console.warn('useTeamPluginConfig: Shell context not ready');
    },
  };
}
