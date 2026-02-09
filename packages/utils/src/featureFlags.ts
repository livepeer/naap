/**
 * Feature Flags Service
 * 
 * Phase 2: Provides feature flag management for gradual rollouts and kill switches.
 * 
 * Features:
 * - Plugin kill switch (remotely disable plugins)
 * - Percentage-based rollouts
 * - User/tenant targeting
 * - Feature flag evaluation
 * 
 * Usage:
 * ```typescript
 * import { featureFlags, isPluginEnabled, isFeatureEnabled } from '@naap/utils';
 * 
 * // Check if a plugin is enabled
 * if (!isPluginEnabled('risky-plugin')) {
 *   console.log('Plugin disabled by kill switch');
 * }
 * 
 * // Check feature flag with percentage rollout
 * if (isFeatureEnabled('new-api-format', { userId: user.id })) {
 *   return newFormatResponse(data);
 * }
 * ```
 */

// ============================================
// Types
// ============================================

export interface FeatureFlag {
  /** Unique flag name */
  name: string;
  /** Whether the flag is enabled */
  enabled: boolean;
  /** Optional: Percentage of users (0-100) */
  percentage?: number;
  /** Optional: Specific user IDs to include */
  includeUsers?: string[];
  /** Optional: Specific user IDs to exclude */
  excludeUsers?: string[];
  /** Optional: Specific tenant IDs to include */
  includeTenants?: string[];
  /** Optional: Specific tenant IDs to exclude */
  excludeTenants?: string[];
  /** Optional: Description */
  description?: string;
  /** Optional: Last updated timestamp */
  updatedAt?: string;
}

export interface PluginKillSwitch {
  /** Plugin name */
  pluginName: string;
  /** Whether the plugin is disabled */
  disabled: boolean;
  /** Reason for disabling */
  reason?: string;
  /** When the kill switch was activated */
  activatedAt?: string;
  /** Who activated it */
  activatedBy?: string;
}

export interface FeatureFlagContext {
  /** Current user ID */
  userId?: string;
  /** Current tenant/team ID */
  tenantId?: string;
  /** Current plugin name */
  pluginName?: string;
  /** Additional context */
  [key: string]: string | undefined;
}

// ============================================
// State
// ============================================

// In-memory stores (replace with Redis/database in production)
const featureFlagsStore = new Map<string, FeatureFlag>();
const killSwitchesStore = new Map<string, PluginKillSwitch>();

// Remote flag URL (for fetching flags from server)
let remoteFlagUrl: string | null = null;
let lastFetchTime = 0;
const FETCH_INTERVAL_MS = 60000; // 1 minute

// ============================================
// Feature Flag Management
// ============================================

/**
 * Set a feature flag
 */
export function setFeatureFlag(flag: FeatureFlag): void {
  featureFlagsStore.set(flag.name, {
    ...flag,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Get a feature flag
 */
export function getFeatureFlag(name: string): FeatureFlag | undefined {
  return featureFlagsStore.get(name);
}

/**
 * Get all feature flags
 */
export function getAllFeatureFlags(): FeatureFlag[] {
  return Array.from(featureFlagsStore.values());
}

/**
 * Delete a feature flag
 */
export function deleteFeatureFlag(name: string): boolean {
  return featureFlagsStore.delete(name);
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(name: string, context?: FeatureFlagContext): boolean {
  const flag = featureFlagsStore.get(name);
  
  // Default to false if flag doesn't exist
  if (!flag) {
    return false;
  }
  
  // Check if globally disabled
  if (!flag.enabled) {
    return false;
  }
  
  // Check user exclusions
  if (context?.userId && flag.excludeUsers?.includes(context.userId)) {
    return false;
  }
  
  // Check tenant exclusions
  if (context?.tenantId && flag.excludeTenants?.includes(context.tenantId)) {
    return false;
  }
  
  // Check user inclusions (override percentage)
  if (context?.userId && flag.includeUsers?.includes(context.userId)) {
    return true;
  }
  
  // Check tenant inclusions (override percentage)
  if (context?.tenantId && flag.includeTenants?.includes(context.tenantId)) {
    return true;
  }
  
  // Check percentage rollout
  if (flag.percentage !== undefined && flag.percentage < 100) {
    // Use consistent hashing based on user ID for sticky assignment
    const hash = context?.userId 
      ? hashString(context.userId + name) 
      : Math.random() * 100;
    return (hash % 100) < flag.percentage;
  }
  
  return true;
}

// ============================================
// Plugin Kill Switch
// ============================================

/**
 * Activate kill switch for a plugin
 */
export function activateKillSwitch(
  pluginName: string, 
  reason?: string,
  activatedBy?: string
): void {
  killSwitchesStore.set(pluginName, {
    pluginName,
    disabled: true,
    reason,
    activatedAt: new Date().toISOString(),
    activatedBy,
  });
  
  console.warn(`[KillSwitch] Plugin "${pluginName}" disabled: ${reason || 'No reason provided'}`);
}

/**
 * Deactivate kill switch for a plugin
 */
export function deactivateKillSwitch(pluginName: string): void {
  killSwitchesStore.delete(pluginName);
  console.log(`[KillSwitch] Plugin "${pluginName}" re-enabled`);
}

/**
 * Get kill switch status for a plugin
 */
export function getKillSwitch(pluginName: string): PluginKillSwitch | undefined {
  return killSwitchesStore.get(pluginName);
}

/**
 * Get all active kill switches
 */
export function getActiveKillSwitches(): PluginKillSwitch[] {
  return Array.from(killSwitchesStore.values()).filter(k => k.disabled);
}

/**
 * Check if a plugin is enabled (not killed)
 */
export function isPluginEnabled(pluginName: string): boolean {
  const killSwitch = killSwitchesStore.get(pluginName);
  return !killSwitch?.disabled;
}

/**
 * Check if plugin should load based on all conditions
 */
export function shouldLoadPlugin(pluginName: string, context?: FeatureFlagContext): boolean {
  // Check kill switch first
  if (!isPluginEnabled(pluginName)) {
    return false;
  }
  
  // Check plugin-specific feature flag
  const flagName = `plugin:${pluginName}:enabled`;
  const flag = getFeatureFlag(flagName);
  
  // If no flag exists, plugin is enabled by default
  if (!flag) {
    return true;
  }
  
  return isFeatureEnabled(flagName, context);
}

// ============================================
// Remote Flag Sync
// ============================================

/**
 * Configure remote flag URL
 */
export function configureRemoteFlags(url: string): void {
  remoteFlagUrl = url;
}

/**
 * Fetch flags from remote server
 */
export async function fetchRemoteFlags(): Promise<void> {
  if (!remoteFlagUrl) {
    return;
  }
  
  // Throttle fetches
  const now = Date.now();
  if (now - lastFetchTime < FETCH_INTERVAL_MS) {
    return;
  }
  
  try {
    const response = await fetch(remoteFlagUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json() as {
      featureFlags?: FeatureFlag[];
      killSwitches?: PluginKillSwitch[];
    };
    
    // Update feature flags
    if (data.featureFlags) {
      for (const flag of data.featureFlags) {
        setFeatureFlag(flag);
      }
    }
    
    // Update kill switches
    if (data.killSwitches) {
      for (const killSwitch of data.killSwitches) {
        if (killSwitch.disabled) {
          killSwitchesStore.set(killSwitch.pluginName, killSwitch);
        } else {
          killSwitchesStore.delete(killSwitch.pluginName);
        }
      }
    }
    
    lastFetchTime = now;
    console.log('[FeatureFlags] Remote flags synced successfully');
    
  } catch (error) {
    console.error('[FeatureFlags] Failed to fetch remote flags:', error);
  }
}

/**
 * Start periodic flag refresh
 */
export function startFlagRefresh(intervalMs = FETCH_INTERVAL_MS): () => void {
  const interval = setInterval(fetchRemoteFlags, intervalMs);
  
  // Fetch immediately
  fetchRemoteFlags();
  
  // Return cleanup function
  return () => clearInterval(interval);
}

// ============================================
// Utilities
// ============================================

/**
 * Simple string hash for consistent percentage rollout
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Reset all feature flags and kill switches (for testing)
 */
export function resetAllFlags(): void {
  featureFlagsStore.clear();
  killSwitchesStore.clear();
}

// ============================================
// Convenience Export
// ============================================

export const featureFlags = {
  set: setFeatureFlag,
  get: getFeatureFlag,
  getAll: getAllFeatureFlags,
  delete: deleteFeatureFlag,
  isEnabled: isFeatureEnabled,
  
  killSwitch: {
    activate: activateKillSwitch,
    deactivate: deactivateKillSwitch,
    get: getKillSwitch,
    getActive: getActiveKillSwitches,
    isPluginEnabled,
  },
  
  plugin: {
    shouldLoad: shouldLoadPlugin,
    isEnabled: isPluginEnabled,
  },
  
  remote: {
    configure: configureRemoteFlags,
    fetch: fetchRemoteFlags,
    startRefresh: startFlagRefresh,
  },
  
  reset: resetAllFlags,
};
