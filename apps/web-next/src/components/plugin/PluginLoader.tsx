'use client';

/**
 * PluginLoader Component
 *
 * A React component that loads and renders UMD plugins from CDN.
 * Handles loading states, errors, and cleanup.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import {
  loadUMDPlugin,
  mountUMDPlugin,
  isUMDPluginCached,
  clearUMDPluginCache,
  type LoadedUMDPlugin,
  type UMDLoadOptions,
} from '@/lib/plugins/umd-loader';
import { useShell } from '@/contexts/shell-context';
import { createSandboxedContext } from '@/lib/plugins/sandbox';
import { getPluginFeatureFlags } from '@/lib/plugins/feature-flags';

/**
 * Plugin loading status
 */
export type PluginLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Plugin info for loading
 */
export interface PluginInfo {
  /** Plugin name */
  name: string;

  /** Display name */
  displayName?: string;

  /** CDN bundle URL */
  bundleUrl: string;

  /** CDN styles URL (optional) */
  stylesUrl?: string;

  /** Global name for UMD module */
  globalName: string;

  /** Content hash for validation */
  bundleHash?: string;
}

/**
 * Props for PluginLoader component
 */
export interface PluginLoaderProps {
  /** Plugin info to load */
  plugin: PluginInfo;

  /** Additional class name for container */
  className?: string;

  /** Timeout for loading (ms) */
  timeout?: number;

  /** Callback when plugin is loaded */
  onLoad?: (plugin: LoadedUMDPlugin) => void;

  /** Callback on error */
  onError?: (error: Error) => void;

  /** Show loading indicator */
  showLoading?: boolean;

  /** Show error UI */
  showError?: boolean;

  /** Fallback content while loading */
  fallback?: React.ReactNode;
}

/**
 * Build shell config key for plugin backend endpoints.
 * Format: `${camelCase(pluginName)}EndpointUrl` (e.g. `myWalletEndpointUrl`).
 */
function getShellEndpointUrlKey(pluginName: string): string {
  const camelCaseName = pluginName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `${camelCaseName}EndpointUrl`;
}

/**
 * PluginLoader Component
 */
export function PluginLoader({
  plugin,
  className = '',
  timeout = 30000,
  onLoad,
  onError,
  showLoading = true,
  showError = true,
  fallback,
}: PluginLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);

  const [status, setStatus] = useState<PluginLoadStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const shell = useShell();

  // Use refs for callbacks and shell to prevent infinite re-renders
  // The shell object changes frequently (auth, theme, etc.) but we only need
  // the current value at mount time, not on every change
  const shellRef = useRef(shell);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);

  // Update refs on each render (but don't trigger re-mount)
  shellRef.current = shell;
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  // Load and mount the plugin
  // IMPORTANT: Only depends on plugin identity (name, bundleUrl) and timeout
  // Shell context and callbacks are accessed via refs to prevent infinite re-renders
  const loadAndMountPlugin = useCallback(async () => {
    // Wait for container to be available (React may not have committed DOM yet)
    // This is a defensive check - normally the container should be available immediately
    let attempts = 0;
    while (!containerRef.current && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 50));
      attempts++;
    }

    if (!containerRef.current) {
      console.error(`[PluginLoader] Container ref not available after ${attempts} attempts`);
      return;
    }

    // Prevent duplicate mounts
    if (mountedRef.current) {
      console.log(`[PluginLoader] Plugin ${plugin.name} already mounted, skipping`);
      return;
    }

    setStatus('loading');
    setError(null);
    setProgress(0);

    const flags = getPluginFeatureFlags();

    try {
      const options: UMDLoadOptions = {
        name: plugin.name,
        bundleUrl: plugin.bundleUrl,
        stylesUrl: plugin.stylesUrl,
        globalName: plugin.globalName,
        bundleHash: plugin.bundleHash,
        timeout,
        onProgress: setProgress,
      };

      const loaded = await loadUMDPlugin(options);

      // Get shell from ref (current value, not stale closure)
      const currentShell = shellRef.current;
      const sameOriginEndpointUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const pluginEndpointUrlKey = getShellEndpointUrlKey(plugin.name);

      // Create base shell context for plugin
      // NOTE: Must include all services from ShellContext interface for hooks to work
      // config: When plugins are embedded in the shell, use same-origin for API calls.
      // getServiceOrigin() checks shellContext.config using plugin-derived EndpointUrl keys first.
      const baseContext = {
        auth: currentShell.auth,
        notifications: currentShell.notifications,
        navigate: currentShell.navigate,
        eventBus: currentShell.eventBus,
        theme: currentShell.theme,
        logger: currentShell.logger,
        permissions: currentShell.permissions,
        integrations: currentShell.integrations,
        capabilities: currentShell.capabilities,
        version: '1.0.0',
        pluginBasePath: `/plugins/${plugin.name}`,
        // Include API client for backend communication (Phase 8 fix)
        api: currentShell.api,
        // Include tenant and team context for multi-tenancy support
        tenant: currentShell.tenant,
        team: currentShell.team,
        config: {
          // Same-origin so embedded plugins use shell's API routes (avoids Failed to fetch when standalone backend isn't running)
          [pluginEndpointUrlKey]: sameOriginEndpointUrl,
          baseEndpointUrl: sameOriginEndpointUrl,
        },
      };

      // Trusted plugins need auth token access (no strict sandboxing).
      // Determined from plugin metadata rather than a hardcoded list.
      const pluginMeta = plugin as Record<string, unknown>;
      const isCorePlugin = pluginMeta.trusted === true || !pluginMeta.thirdParty;

      // Apply sandboxing if enabled
      const pluginContext = flags.enableSandbox
        ? createSandboxedContext(baseContext, {
            pluginName: plugin.name,
            pluginBasePath: `/plugins/${plugin.name}`,
            strictMode: !isCorePlugin, // Core plugins need token access
          })
        : baseContext;

      // Clean up previous mount
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      // Verify container is still available (component might have unmounted during async load)
      if (!containerRef.current) {
        console.warn(`[PluginLoader] Container unmounted during load of ${plugin.name}`);
        return;
      }

      // Mount the plugin
      cleanupRef.current = mountUMDPlugin(loaded, containerRef.current, pluginContext);
      mountedRef.current = true;

      setStatus('loaded');
      onLoadRef.current?.(loaded);
    } catch (err) {
      const loadError = err instanceof Error ? err : new Error(String(err));
      setError(loadError);
      setStatus('error');
      onErrorRef.current?.(loadError);
      console.error(`[PluginLoader] Failed to load plugin ${plugin.name}:`, loadError);
      // Clear cache so retry will force fresh load
      clearUMDPluginCache(plugin.bundleUrl);
    }
  }, [plugin.name, plugin.bundleUrl, plugin.stylesUrl, plugin.globalName, plugin.bundleHash, timeout]);

  // Initial load - only runs when plugin identity changes
  useEffect(() => {
    // Reset mounted flag for new plugin
    mountedRef.current = false;
    loadAndMountPlugin();

    return () => {
      // Cleanup on unmount or plugin change
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      mountedRef.current = false;
    };
  }, [loadAndMountPlugin]);

  // Retry handler - clears cache and reloads
  const handleRetry = useCallback(() => {
    // Clear cache for this bundle URL to force re-download
    clearUMDPluginCache(plugin.bundleUrl);
    // Reset state for clean retry
    mountedRef.current = false;
    setError(null);
    setStatus('idle');
    // Small delay to ensure state is reset before reloading
    setTimeout(() => {
      loadAndMountPlugin();
    }, 0);
  }, [loadAndMountPlugin, plugin.bundleUrl]);

  // Open plugin directly in new tab
  const handleOpenDirect = useCallback(() => {
    window.open(plugin.bundleUrl.replace(/\.js$/, '.html'), '_blank');
  }, [plugin.bundleUrl]);

  // Render loading overlay
  const renderLoadingOverlay = () => {
    if (status !== 'loading' || !showLoading) return null;

    if (fallback) {
      return (
        <div className="absolute inset-0 z-10">
          {fallback}
        </div>
      );
    }

    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <div className="space-y-1">
            <p className="text-text-secondary text-sm">
              Loading {plugin.displayName || plugin.name}...
            </p>
            {progress > 0 && progress < 1 && (
              <div className="w-48 mx-auto">
                <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-blue transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
            {isUMDPluginCached(plugin.bundleUrl) && (
              <p className="text-text-tertiary text-xs">Loading from cache</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render error overlay
  const renderErrorOverlay = () => {
    if (status !== 'error' || !showError || !error) return null;

    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary">
        <div className="text-center space-y-4 p-6 max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <div className="space-y-2">
            <h3 className="font-semibold text-text-primary">
              Failed to load plugin
            </h3>
            <p className="text-text-secondary text-sm">{error.message}</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleRetry}
              className="flex items-center gap-2 px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
            <button
              onClick={handleOpenDirect}
              className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary text-text-secondary rounded-lg hover:bg-bg-tertiary/80 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open Directly
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ALWAYS render the container div - overlays are positioned absolutely on top
  // This ensures containerRef.current is always available for mounting
  return (
    <div className={`relative plugin-wrapper h-[calc(100vh-8rem)] min-h-[calc(100vh-8rem)] ${className}`}>
      {renderLoadingOverlay()}
      {renderErrorOverlay()}
      <div
        ref={containerRef}
        className="plugin-container w-full h-full"
        data-plugin-name={plugin.name}
        data-plugin-status={status}
      />
    </div>
  );
}

/**
 * Hook for loading a UMD plugin imperatively
 */
export function useUMDPlugin(options: UMDLoadOptions | null) {
  const [plugin, setPlugin] = useState<LoadedUMDPlugin | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!options) return;

    setLoading(true);
    setError(null);

    loadUMDPlugin(options)
      .then(setPlugin)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [options?.bundleUrl, options?.globalName]);

  return { plugin, loading, error };
}

export default PluginLoader;
