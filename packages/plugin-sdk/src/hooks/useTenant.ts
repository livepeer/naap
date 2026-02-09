/**
 * useTenant Hook
 * Provides access to multi-tenant plugin functionality
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from './useShell.js';
import type { ITenantService, ITenantContext, TenantInstallation, TenantConfig } from '../types/services.js';

/**
 * Hook to access the tenant service
 */
export function useTenant(): ITenantService | undefined {
  const shell = useShell();
  return shell.tenant;
}

/**
 * Hook to access the tenant context state.
 * Use this to detect if the current plugin is running in a tenant context.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isTenantContext, currentInstallation } = useTenantContext();
 *   
 *   if (isTenantContext) {
 *     return <div>Running as tenant installation: {currentInstallation?.id}</div>;
 *   }
 *   
 *   return <div>Not in tenant context</div>;
 * }
 * ```
 */
export function useTenantContext(): ITenantContext {
  const shell = useShell();
  // Access the tenantContext from shell if available, otherwise return a default
  const tenantContext = (shell as any).tenantContext as ITenantContext | undefined;
  
  if (!tenantContext) {
    // Return a default non-tenant context
    return {
      currentInstallation: null,
      isTenantContext: false,
      setCurrentPlugin: async () => {},
      refreshInstallation: async () => {},
      isLoading: false,
    };
  }
  
  return tenantContext;
}

/**
 * Hook to get the current plugin's installation for the user
 */
export function usePluginInstallation(pluginName: string): {
  installation: TenantInstallation | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const tenant = useTenant();
  const [installation, setInstallation] = useState<TenantInstallation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchInstallation = useCallback(async () => {
    if (!tenant) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await tenant.getInstallationByPlugin(pluginName);
      setInstallation(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch installation'));
    } finally {
      setLoading(false);
    }
  }, [tenant, pluginName]);

  useEffect(() => {
    fetchInstallation();
  }, [fetchInstallation]);

  return { installation, loading, error, refetch: fetchInstallation };
}

/**
 * Hook to get the current plugin's configuration
 */
export function usePluginTenantConfig(installId: string | undefined): {
  config: TenantConfig | null;
  loading: boolean;
  error: Error | null;
  updateConfig: (config: Partial<TenantConfig>) => Promise<void>;
  refetch: () => void;
} {
  const tenant = useTenant();
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!tenant || !installId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await tenant.getConfig(installId);
      setConfig(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch config'));
    } finally {
      setLoading(false);
    }
  }, [tenant, installId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateConfig = useCallback(async (newConfig: Partial<TenantConfig>) => {
    if (!tenant || !installId) {
      throw new Error('Tenant service not available');
    }

    const updated = await tenant.updateConfig(installId, newConfig);
    setConfig(updated);
  }, [tenant, installId]);

  return { config, loading, error, updateConfig, refetch: fetchConfig };
}

/**
 * Hook to manage plugin preferences
 */
export function usePluginPreferences(installId: string | undefined): {
  enabled: boolean;
  order: number;
  pinned: boolean;
  updatePreferences: (prefs: { enabled?: boolean; order?: number; pinned?: boolean }) => Promise<void>;
} {
  const tenant = useTenant();
  const [enabled, setEnabled] = useState(true);
  const [order, setOrder] = useState(0);
  const [pinned, setPinned] = useState(false);

  const updatePreferences = useCallback(async (prefs: {
    enabled?: boolean;
    order?: number;
    pinned?: boolean;
  }) => {
    if (!tenant || !installId) {
      throw new Error('Tenant service not available');
    }

    const updated = await tenant.updatePreferences(installId, prefs);
    setEnabled(updated.enabled);
    setOrder(updated.order);
    setPinned(updated.pinned);
  }, [tenant, installId]);

  return { enabled, order, pinned, updatePreferences };
}

/**
 * Hook to check if user has a specific plugin installed
 */
export function useHasPlugin(pluginName: string): {
  hasPlugin: boolean;
  loading: boolean;
} {
  const tenant = useTenant();
  const [hasPlugin, setHasPlugin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) {
      setLoading(false);
      return;
    }

    tenant.hasPlugin(pluginName).then((result) => {
      setHasPlugin(result);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [tenant, pluginName]);

  return { hasPlugin, loading };
}

/**
 * Hook to list all user's installed plugins
 */
export function useUserPlugins(): {
  plugins: TenantInstallation[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const tenant = useTenant();
  const [plugins, setPlugins] = useState<TenantInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPlugins = useCallback(async () => {
    if (!tenant) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await tenant.listInstallations();
      setPlugins(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to fetch plugins'));
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  return { plugins, loading, error, refetch: fetchPlugins };
}

/**
 * Hook for installing/uninstalling plugins
 */
export function usePluginActions(): {
  install: (packageName: string, config?: Record<string, unknown>) => Promise<{
    installation: TenantInstallation;
    isFirstInstall: boolean;
  }>;
  uninstall: (installId: string) => Promise<{
    success: boolean;
    shouldCleanup: boolean;
  }>;
} {
  const tenant = useTenant();

  const install = useCallback(async (packageName: string, config?: Record<string, unknown>) => {
    if (!tenant) {
      throw new Error('Tenant service not available');
    }
    return tenant.install(packageName, config);
  }, [tenant]);

  const uninstall = useCallback(async (installId: string) => {
    if (!tenant) {
      throw new Error('Tenant service not available');
    }
    return tenant.uninstall(installId);
  }, [tenant]);

  return { install, uninstall };
}
