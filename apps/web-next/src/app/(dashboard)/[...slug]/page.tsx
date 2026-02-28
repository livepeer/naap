'use client';

/**
 * Catch-All Plugin Page
 *
 * Handles rendering for plugins whose routes don't match any dedicated Next.js
 * page (e.g. /daydream, /my-tool). Falls through to a 404 when the current
 * path doesn't correspond to any registered plugin.
 *
 * More specific routes (marketplace, settings, plugins/[pluginName], etc.)
 * take precedence — Next.js always prefers the most specific match.
 */

import { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { usePlugins } from '@/contexts/plugin-context';
import { Loader2, AlertCircle, RefreshCw, Cloud } from 'lucide-react';
import Link from 'next/link';
import { PluginLoader, type PluginInfo } from '@/components/plugin/PluginLoader';
import { PluginInfoButton, type PluginMetadata } from '@/components/plugin/PluginInfoButton';

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[-_]/g, '');
}

export default function CatchAllPluginPage() {
  const pathname = usePathname();
  const { plugins, isLoading: pluginsLoading } = usePlugins();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = useCallback(() => {
    setStatus('loading');
    setError(null);
    setRetryKey(k => k + 1);
  }, []);

  // Find the plugin whose registered routes match the current pathname.
  // Route patterns end with /* for sub-paths (e.g. "/daydream/*").
  const plugin = useMemo(() => {
    if (!pathname || pluginsLoading) return undefined;
    return plugins.find(p => {
      if (!p.enabled || !p.routes || p.routes.length === 0) return false;
      return (p.routes as string[]).some(route => {
        const baseRoute = route.replace(/\/?\*$/, '');
        if (!baseRoute) return false;
        return pathname === baseRoute || pathname.startsWith(baseRoute + '/');
      });
    });
  }, [pathname, plugins, pluginsLoading]);

  const cdnPluginInfo: PluginInfo | null = useMemo(() => {
    if (!plugin?.bundleUrl) return null;
    const pluginName = plugin.name;
    return {
      name: pluginName,
      displayName: plugin.displayName,
      bundleUrl: plugin.bundleUrl,
      stylesUrl: plugin.stylesUrl,
      globalName: plugin.globalName || `NaapPlugin${pluginName.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}`,
      bundleHash: plugin.bundleHash,
    };
  }, [plugin]);

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

  if (pluginsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Loading plugins...</p>
      </div>
    );
  }

  // No plugin matches this path — render 404
  if (!plugin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-24">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
          <h2 className="text-2xl font-semibold mb-4">Page Not Found</h2>
          <p className="text-muted-foreground mb-8">
            The page you are looking for does not exist or has been moved.
          </p>
          <Link
            href="/"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  if (!plugin.bundleUrl || status === 'error') {
    const displayError = error || (!plugin.bundleUrl ? 'No CDN bundle URL configured for this plugin' : 'Plugin failed to load');
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold mt-4">Plugin Error</h2>
        <p className="text-muted-foreground mt-2">{displayError}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md text-center">
          Plugin: {plugin.name} (CDN)
          {cdnPluginInfo?.bundleUrl && (
            <>
              <br />
              CDN URL: {cdnPluginInfo.bundleUrl}
            </>
          )}
        </p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 mt-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

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
        key={`cdn-catchall-${plugin.name}-${retryKey}`}
        plugin={cdnPluginInfo!}
        className="h-[calc(100vh-8rem)]"
        onLoad={() => setStatus('ready')}
        onError={(err) => {
          console.error(`[CatchAllPluginPage] CDN load failed for ${plugin.name}:`, err);
          setError(err.message);
          setStatus('error');
        }}
      />
    </div>
  );
}
