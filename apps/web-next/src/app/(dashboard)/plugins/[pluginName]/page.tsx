'use client';

import { useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePlugins } from '@/contexts/plugin-context';
import { Loader2, AlertCircle, RefreshCw, Cloud } from 'lucide-react';
import { PluginLoader, type PluginInfo } from '@/components/plugin/PluginLoader';
import { PluginInfoButton, type PluginMetadata } from '@/components/plugin/PluginInfoButton';

// Security: Allowed plugin hosts (configurable via env)
const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  'naap.dev',
  'vercel.app',
  'blob.vercel-storage.com',
];

const ALLOWED_HOSTS = (() => {
  const envHosts = process.env.NEXT_PUBLIC_PLUGIN_ALLOWED_HOSTS;
  if (envHosts) {
    return [...DEFAULT_ALLOWED_HOSTS, ...envHosts.split(',').map(h => h.trim()).filter(Boolean)];
  }
  return DEFAULT_ALLOWED_HOSTS;
})();

/**
 * Plugin Loading Strategy:
 *
 * All plugins are loaded via UMD/CDN bundles (same-origin).
 * This enables camera/microphone permissions and avoids CORS issues.
 */

export default function PluginPage() {
  const params = useParams();
  const pluginName = params.pluginName as string;
  const { plugins, isLoading: pluginsLoading } = usePlugins();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // Find the plugin - memoized to prevent unnecessary recalculations
  const plugin = useMemo(
    () => plugins.find(p => p.name === pluginName),
    [plugins, pluginName]
  );

  // Compute CDN plugin info - MEMOIZED to prevent infinite re-renders
  const cdnPluginInfo: PluginInfo | null = useMemo(() => {
    if (!plugin?.bundleUrl) return null;
    return {
      name: pluginName,
      displayName: plugin.displayName,
      bundleUrl: plugin.bundleUrl,
      stylesUrl: plugin.stylesUrl,
      // Use globalName from manifest if available, otherwise derive from plugin name
      globalName: plugin.globalName || `NaapPlugin${pluginName.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}`,
      bundleHash: plugin.bundleHash,
    };
  }, [plugin, pluginName]);

  // Compute plugin metadata for the info button
  const pluginMetadata: PluginMetadata | null = useMemo(() => {
    if (!plugin) return null;
    return {
      name: plugin.name,
      displayName: plugin.displayName,
      installedVersion: plugin.version || '1.0.0',
      latestVersion: plugin.latestVersion || plugin.version || '1.0.0',
      publisher: plugin.author || plugin.publisher || 'NAAP Team',
      installedAt: plugin.installedAt || plugin.createdAt,
      createdAt: plugin.createdAt,
      category: plugin.category,
      deploymentType: 'cdn',
    };
  }, [plugin]);

  // Validate plugin - set error states
  // This runs via the effect in the status check below
  const validationError = useMemo(() => {
    if (pluginsLoading) return null;
    if (!plugin) return 'Plugin not found';
    if (!plugin.enabled) return 'Plugin is disabled';
    if (!plugin.bundleUrl) return 'No CDN bundle URL configured for this plugin';

    // Validate the bundleUrl host
    try {
      const url = new URL(plugin.bundleUrl);
      const hostname = url.hostname;
      const isAllowed = ALLOWED_HOSTS.some(host =>
        hostname === host || hostname.endsWith('.' + host)
      );
      if (!isAllowed && process.env.NODE_ENV === 'production') {
        return 'Plugin CDN URL not in allowed hosts';
      }
    } catch {
      return 'Invalid plugin CDN URL';
    }

    return null;
  }, [plugin, pluginsLoading]);

  // Retry handler
  const [retryKey, setRetryKey] = useState(0);
  const handleRetry = useCallback(() => {
    setStatus('loading');
    setError(null);
    setRetryKey(k => k + 1);
  }, []);

  if (pluginsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Loading plugins...</p>
      </div>
    );
  }

  if (validationError || status === 'error') {
    const displayError = error || validationError;
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold mt-4">Plugin Error</h2>
        <p className="text-muted-foreground mt-2">{displayError}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md text-center">
          Plugin: {pluginName} (CDN)
          {cdnPluginInfo?.bundleUrl && (
            <>
              <br />
              CDN URL: {cdnPluginInfo.bundleUrl}
            </>
          )}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!cdnPluginInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Detecting plugin...</p>
      </div>
    );
  }

  // Render CDN plugin using PluginLoader
  return (
    <div className="relative h-[calc(100vh-8rem)] min-h-[calc(100vh-8rem)]">
      <div className="absolute top-2 right-2 z-10">
        <div className="flex items-center gap-1 px-2 py-1 bg-accent-blue/20 text-accent-blue rounded-lg text-xs font-medium">
          <Cloud className="w-3 h-3" /> CDN
        </div>
      </div>
      {pluginMetadata && (
        <div className="absolute bottom-4 right-4 z-10">
          <PluginInfoButton metadata={pluginMetadata} />
        </div>
      )}
      <PluginLoader
        key={`cdn-${pluginName}-${retryKey}`}
        plugin={cdnPluginInfo}
        className="h-[calc(100vh-8rem)]"
        onLoad={() => setStatus('ready')}
        onError={(err) => {
          console.error(`[PluginPage] CDN load failed for ${pluginName}:`, err);
          setError(err.message);
          setStatus('error');
        }}
      />
    </div>
  );
}
