/**
 * Unified Plugin Configuration Hook
 * 
 * A single, consistent API for plugin configuration across all contexts:
 * - Personal workspace
 * - Team context (with shared + personal config)
 * - Tenant context
 * 
 * This replaces the previous fragmented config hooks with a unified API.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useShell } from './useShell.js';
import { useTeam } from './useTeam.js';
import { useTenant, useTenantContext } from './useTenant.js';
import { useApiClient } from './useApiClient.js';

/**
 * Configuration scope
 */
export type ConfigScope = 'personal' | 'team' | 'tenant' | 'auto';

/**
 * Unified plugin config options
 */
export interface UnifiedPluginConfigOptions<T = Record<string, unknown>> {
  /**
   * Plugin name (optional - auto-detected from context if not provided)
   */
  pluginName?: string;

  /**
   * Default configuration values
   */
  defaults?: T;

  /**
   * Configuration scope
   * - 'personal': User-specific config
   * - 'team': Team-scoped config (with shared + personal)
   * - 'tenant': Tenant installation config
   * - 'auto': Automatically detect based on current context (default)
   */
  scope?: ConfigScope;

  /**
   * Whether to auto-save changes (default: true)
   */
  autoSave?: boolean;
}

/**
 * Unified plugin config result
 */
export interface UnifiedPluginConfigResult<T = Record<string, unknown>> {
  /**
   * Current configuration (merged from all sources based on scope)
   */
  config: T;

  /**
   * Shared configuration (team scope only)
   */
  sharedConfig?: T;

  /**
   * Personal configuration overrides (team scope only)
   */
  personalConfig?: Partial<T>;

  /**
   * Loading state
   */
  loading: boolean;

  /**
   * Error if any
   */
  error: Error | null;

  /**
   * Update configuration
   * In team scope, this updates personal config only
   */
  updateConfig: (updates: Partial<T>) => Promise<void>;

  /**
   * Update shared configuration (team scope only, requires permission)
   */
  updateSharedConfig?: (updates: Partial<T>) => Promise<void>;

  /**
   * Reset configuration to defaults
   */
  resetConfig: () => Promise<void>;

  /**
   * Refresh configuration from server
   */
  refresh: () => Promise<void>;

  /**
   * Current scope being used
   */
  currentScope: 'personal' | 'team' | 'tenant';
}

/**
 * Unified hook for plugin configuration.
 * 
 * Automatically detects context (personal/team/tenant) and provides
 * appropriate configuration management.
 * 
 * @example
 * ```typescript
 * // Auto-detect context
 * function MySettings() {
 *   const { config, updateConfig, loading } = usePluginConfig({
 *     defaults: { theme: 'dark', notifications: true }
 *   });
 *   
 *   if (loading) return <LoadingSpinner />;
 *   
 *   return (
 *     <div>
 *       <Switch
 *         checked={config.notifications}
 *         onChange={(e) => updateConfig({ notifications: e.target.checked })}
 *       />
 *     </div>
 *   );
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Force personal scope
 * function UserPreferences() {
 *   const { config, updateConfig } = usePluginConfig({
 *     scope: 'personal',
 *     defaults: { emailFrequency: 'daily' }
 *   });
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Team configuration with shared settings
 * function TeamSettings() {
 *   const {
 *     config,                  // Merged config (shared + personal)
 *     sharedConfig,           // Team-wide defaults
 *     personalConfig,         // Your overrides
 *     updateConfig,           // Update personal config
 *     updateSharedConfig,     // Update shared config (admin only)
 *     currentScope
 *   } = usePluginConfig({
 *     scope: 'team',
 *     defaults: { apiKey: '', maxUsers: 10 }
 *   });
 *   
 *   return (
 *     <div>
 *       <h3>Scope: {currentScope}</h3>
 *       {updateSharedConfig && (
 *         <div>
 *           <h4>Team Defaults</h4>
 *           <input
 *             value={sharedConfig?.apiKey}
 *             onChange={(e) => updateSharedConfig({ apiKey: e.target.value })}
 *           />
 *         </div>
 *       )}
 *       <div>
 *         <h4>Your Settings</h4>
 *         <input
 *           value={config.apiKey}
 *           onChange={(e) => updateConfig({ apiKey: e.target.value })}
 *         />
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePluginConfig<T extends Record<string, unknown>>(
  options: UnifiedPluginConfigOptions<T> = {}
): UnifiedPluginConfigResult<T> {
  const {
    pluginName = 'unknown',
    defaults = {} as T,
    scope = 'auto',
    autoSave = true,
  } = options;

  const shell = useShell();
  const team = useTeam();
  const tenant = useTenant();
  const tenantContext = useTenantContext();
  const api = useApiClient({ pluginName });

  // Determine effective scope
  const effectiveScope: 'personal' | 'team' | 'tenant' = useMemo(() => {
    if (scope !== 'auto') return scope;

    // Auto-detect based on context - team takes priority
    if (team?.isTeamContext && team.currentTeam) {
      return 'team';
    }

    // Check if we're in a tenant installation context
    // Tenant context is detected when there's an active installation for the plugin
    if (tenantContext.isTenantContext) {
      return 'tenant';
    }

    // Default to personal scope
    return 'personal';
  }, [scope, team, tenantContext.isTenantContext]);

  // State
  const [config, setConfig] = useState<T>(defaults);
  const [sharedConfig, setSharedConfig] = useState<T | undefined>(undefined);
  const [personalConfig, setPersonalConfig] = useState<Partial<T> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load configuration
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (effectiveScope === 'team' && team?.currentTeam) {
        // Load team configuration (shared + personal)
        const teamId = team.currentTeam.id;

        const response = await api.get<{
          sharedConfig: T;
          personalConfig: Partial<T>;
        }>(`/api/v1/teams/${teamId}/plugins/${pluginName}/config`);

        const shared = { ...defaults, ...response.data.sharedConfig };
        const personal = response.data.personalConfig || {};

        setSharedConfig(shared);
        setPersonalConfig(personal);

        // Merge configs: personal overrides shared
        const merged = { ...shared, ...personal } as T;
        setConfig(merged);
      } else if (effectiveScope === 'tenant') {
        // Load tenant configuration
        // Try to use the current installation from context first, fallback to fetching
        const installation = tenantContext.currentInstallation ?? 
          (tenant ? await tenant.getInstallationByPlugin(pluginName) : null);
        if (installation?.config?.settings) {
          setConfig({ ...defaults, ...installation.config.settings } as T);
        } else {
          setConfig(defaults);
        }
      } else {
        // Load personal configuration
        const response = await api.get<{ config: Partial<T> }>(
          `/api/v1/plugins/${pluginName}/config`
        );
        setConfig({ ...defaults, ...response.data.config });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load config');
      // If 404, just use defaults (no config saved yet)
      if ((err as any)?.status !== 404) {
        setError(error);
        console.warn(`Failed to load config for ${pluginName}:`, error);
      }
      setConfig(defaults);
    } finally {
      setLoading(false);
    }
  }, [effectiveScope, team, shell, api, pluginName, defaults, tenant, tenantContext.currentInstallation]);

  // Load on mount and when dependencies change
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Update configuration
  const updateConfig = useCallback(async (updates: Partial<T>) => {
    if (!autoSave) {
      setConfig((prev) => ({ ...prev, ...updates }));
      return;
    }

    setError(null);

    try {
      const newConfig = { ...config, ...updates };

      if (effectiveScope === 'team' && team?.currentTeam) {
        // Update personal config in team context
        const teamId = team.currentTeam.id;
        await api.post(
          `/api/v1/teams/${teamId}/plugins/${pluginName}/config/personal`,
          { config: updates }
        );

        setPersonalConfig((prev) => ({ ...prev, ...updates }));
        setConfig(newConfig);
      } else if (effectiveScope === 'tenant') {
        // Update tenant config
        const installation = tenantContext.currentInstallation ?? 
          (tenant ? await tenant.getInstallationByPlugin(pluginName) : null);
        if (installation && tenant) {
          await tenant.updateConfig(installation.id, {
            settings: newConfig,
          });
        }
        setConfig(newConfig);
      } else {
        // Update personal config
        await api.put(`/api/v1/plugins/${pluginName}/config`, { config: newConfig });
        setConfig(newConfig);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update config');
      setError(error);
      throw error;
    }
  }, [autoSave, config, effectiveScope, team, api, pluginName, tenant, tenantContext.currentInstallation]);

  // Update shared configuration (team scope only)
  const updateSharedConfig = useCallback(async (updates: Partial<T>) => {
    if (effectiveScope !== 'team' || !team?.currentTeam) {
      throw new Error('updateSharedConfig only available in team scope');
    }

    // Check if user has permission to update shared config
    if (!team.hasTeamPermission('plugins.configure')) {
      throw new Error('You do not have permission to update shared configuration');
    }

    setError(null);

    try {
      const teamId = team.currentTeam.id;
      const newSharedConfig = { ...sharedConfig, ...updates } as T;

      await api.put(
        `/api/v1/teams/${teamId}/plugins/${pluginName}/config/shared`,
        { config: newSharedConfig }
      );

      setSharedConfig(newSharedConfig);

      // Update merged config
      const merged = { ...newSharedConfig, ...personalConfig } as T;
      setConfig(merged);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to update shared config');
      setError(error);
      throw error;
    }
  }, [effectiveScope, team, api, pluginName, sharedConfig, personalConfig]);

  // Reset configuration
  const resetConfig = useCallback(async () => {
    setError(null);

    try {
      if (effectiveScope === 'team' && team?.currentTeam) {
        // Reset personal config in team context
        const teamId = team.currentTeam.id;
        await api.delete(`/api/v1/teams/${teamId}/plugins/${pluginName}/config/personal`);

        setPersonalConfig({});
        setConfig(sharedConfig || defaults);
      } else if (effectiveScope === 'tenant') {
        // Reset tenant config
        const installation = tenantContext.currentInstallation ?? 
          (tenant ? await tenant.getInstallationByPlugin(pluginName) : null);
        if (installation && tenant) {
          await tenant.updateConfig(installation.id, { settings: defaults });
        }
        setConfig(defaults);
      } else {
        // Reset personal config
        await api.put(`/api/v1/plugins/${pluginName}/config`, { config: defaults });
        setConfig(defaults);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to reset config');
      setError(error);
      throw error;
    }
  }, [effectiveScope, team, api, pluginName, defaults, sharedConfig, tenant, tenantContext.currentInstallation]);

  // Build result based on scope
  const result: UnifiedPluginConfigResult<T> = {
    config,
    loading,
    error,
    updateConfig,
    resetConfig,
    refresh: loadConfig,
    currentScope: effectiveScope,
  };

  // Add team-specific properties
  if (effectiveScope === 'team') {
    result.sharedConfig = sharedConfig;
    result.personalConfig = personalConfig;

    // Only provide updateSharedConfig if user has permission
    if (team?.hasTeamPermission('plugins.configure')) {
      result.updateSharedConfig = updateSharedConfig;
    }
  }

  return result;
}
