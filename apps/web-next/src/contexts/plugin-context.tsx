'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './auth-context';

// Plugin manifest type
export interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  routes: string[];
  enabled: boolean;
  order: number;
  icon?: string;
  metadata?: Record<string, unknown>;
  // CDN/UMD deployment fields
  bundleUrl?: string;
  stylesUrl?: string;
  bundleHash?: string;
  bundleSize?: number;
  globalName?: string; // UMD global name (e.g., NaapPluginMyWallet)
  // Additional metadata for plugin info
  author?: string;
  publisher?: string;
  latestVersion?: string;
  installedAt?: string;
  createdAt?: string;
  category?: string;
  description?: string;
  // Legacy field - kept for backward compatibility with API responses
  remoteUrl?: string;
  deploymentType?: string;
}

export type PluginStatus = 'enabled' | 'disabled' | 'error' | 'loading' | 'missing';

export interface PluginState {
  manifest: PluginManifest;
  status: PluginStatus;
  error?: string;
}

export interface PluginContextValue {
  plugins: PluginManifest[];
  pluginStates: Map<string, PluginState>;
  isLoading: boolean;
  error: string | null;
  refreshPlugins: () => Promise<void>;
  getPluginState: (name: string) => PluginState | undefined;
  getEnabledPlugins: () => PluginManifest[];
  getDisabledPlugins: () => PluginManifest[];
  /** Version counter that increments on each refresh - useful for triggering re-renders */
  version: number;
}

const PluginContext = createContext<PluginContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export function PluginProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [pluginStates, setPluginStates] = useState<Map<string, PluginState>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const hasFetchedRef = useRef(false);

  // Fetch plugins from API
  const fetchPlugins = useCallback(async () => {
    if (!isAuthenticated) {
      setPlugins([]);
      setPluginStates(new Map());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = typeof window !== 'undefined' 
        ? localStorage.getItem('naap_auth_token') 
        : null;
      
      // Check for team context
      const teamId = typeof window !== 'undefined'
        ? localStorage.getItem('naap_current_team')
        : null;

      // Build URL with team context if available
      let apiUrl = `${API_BASE}/v1/base/plugins/personalized`;
      if (teamId) {
        apiUrl += `?teamId=${encodeURIComponent(teamId)}`;
      }

      const response = await fetch(apiUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch plugins');
      }

      const data = await response.json();
      // Handle both wrapped and unwrapped response formats
      const rawPlugins: PluginManifest[] = data.data?.plugins || data.plugins || [];

      // Normalize plugin name for deduplication (my-wallet == myWallet == mywallet)
      const normalizePluginName = (name: string) => 
        name.toLowerCase().replace(/[-_]/g, '');

      // Deduplicate plugins by normalized name (keep first occurrence)
      const seenNames = new Set<string>();
      const fetchedPlugins = rawPlugins.filter(plugin => {
        const normalized = normalizePluginName(plugin.name);
        if (seenNames.has(normalized)) {
          return false;
        }
        seenNames.add(normalized);
        return true;
      });

      // Sort by order
      fetchedPlugins.sort((a, b) => a.order - b.order);

      // Build plugin states
      const states = new Map<string, PluginState>();
      for (const plugin of fetchedPlugins) {
        states.set(plugin.name, {
          manifest: plugin,
          status: plugin.enabled ? 'enabled' : 'disabled',
        });
      }

      // Always create new array reference to trigger re-renders
      setPlugins([...fetchedPlugins]);
      setPluginStates(new Map(states));
      setVersion(v => v + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error fetching plugins:', message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Initial fetch - only trigger on isAuthenticated change to prevent double-fetching
  useEffect(() => {
    // Prevent double-fetching in StrictMode
    if (hasFetchedRef.current && !isAuthenticated) {
      // Reset when user logs out
      hasFetchedRef.current = false;
      setPlugins([]);
      setPluginStates(new Map());
      setIsLoading(false);
      return;
    }
    
    if (isAuthenticated && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchPlugins();
    } else if (!isAuthenticated) {
      setPlugins([]);
      setPluginStates(new Map());
      setIsLoading(false);
    }
  }, [isAuthenticated, fetchPlugins]);

  // Helper functions
  const getPluginState = useCallback((name: string) => {
    return pluginStates.get(name);
  }, [pluginStates]);

  const getEnabledPlugins = useCallback(() => {
    return plugins.filter(p => p.enabled);
  }, [plugins]);

  const getDisabledPlugins = useCallback(() => {
    return plugins.filter(p => !p.enabled);
  }, [plugins]);

  const value = useMemo<PluginContextValue>(() => ({
    plugins,
    pluginStates,
    isLoading,
    error,
    refreshPlugins: fetchPlugins,
    getPluginState,
    getEnabledPlugins,
    getDisabledPlugins,
    version,
  }), [plugins, pluginStates, isLoading, error, fetchPlugins, getPluginState, getEnabledPlugins, getDisabledPlugins, version]);

  return (
    <PluginContext.Provider value={value}>
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins() {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePlugins must be used within a PluginProvider');
  }
  return context;
}
