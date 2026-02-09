/**
 * Plugin Configuration Hooks
 * 
 * This file exports the new unified config API and maintains backward compatibility
 * with the legacy API.
 */

// Export the new unified API (recommended)
export {
  usePluginConfig,
  type UnifiedPluginConfigOptions as PluginConfigOptions,
  type UnifiedPluginConfigResult as PluginConfigResult,
  type ConfigScope,
} from './usePluginConfig.unified.js';

// Legacy export for simple config value access
import { useState, useEffect } from 'react';
import { createShellApiClient } from '../utils/api.js';

/**
 * Get a single config value with a fallback
 * 
 * @deprecated Use usePluginConfig instead for better type safety and features
 */
export function useConfigValue<T>(
  pluginName: string,
  key: string,
  defaultValue: T,
  authToken?: string
): [T, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = createShellApiClient(authToken);
    
    api.get<{ config: Record<string, unknown> }>(`/api/v1/plugins/${pluginName}/config`)
      .then(response => {
        if (key in response.data.config) {
          setValue(response.data.config[key] as T);
        }
      })
      .catch(() => {
        // Use default on error
      })
      .finally(() => setLoading(false));
  }, [pluginName, key, authToken]);

  return [value, loading];
}
