'use client';

/**
 * Dynamic Plugin Catch-All Route
 *
 * Fallback route for plugins that don't have a filesystem-discovered rewrite
 * in next.config.js (e.g. externally-published, marketplace-installed plugins).
 *
 * Static pages (dashboard, settings, marketplace, etc.) have explicit page files
 * and take precedence over this catch-all.
 *
 * Resolution order for a path like /some-plugin:
 *   1. Static page at (dashboard)/some-plugin/page.tsx → takes precedence
 *   2. beforeFiles rewrite from next.config.js → /plugins/somPlugin
 *   3. This catch-all → looks up "some-plugin" in the plugin context
 */

import { useState, useCallback, useMemo } from 'react';
import { useParams, notFound } from 'next/navigation';
import { usePlugins } from '@/contexts/plugin-context';
import { Loader2, AlertCircle, RefreshCw, Cloud } from 'lucide-react';
import { PluginLoader, type PluginInfo } from '@/components/plugin/PluginLoader';
import { PluginInfoButton, type PluginMetadata } from '@/components/plugin/PluginInfoButton';

const normalizeName = (name: string) => name.toLowerCase().replace(/[-_]/g, '');

export default function PluginCatchAllPage() {
  const params = useParams();
  const slugSegments = params.pluginSlug as string[];
  const pluginSlug = slugSegments?.[0] ?? '';
  const { plugins, isLoading: pluginsLoading } = usePlugins();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const plugin = useMemo(() => {
    if (!pluginSlug) return undefined;
    const normalized = normalizeName(pluginSlug);
    return plugins.find(p => {
      if (normalizeName(p.name) === normalized) return true;
      const routes = (p.routes as string[]) || [];
      return routes.some(r => {
        const routeBase = r.replace(/^\//, '').replace(/\/\*$/, '');
        return normalizeName(routeBase) === normalized;
      });
    });
  }, [pluginSlug, plugins]);

  const cdnPluginInfo: PluginInfo | null = useMemo(() => {
    if (!plugin?.bundleUrl) return null;
    return {
      name: pluginSlug,
      displayName: plugin.displayName,
      bundleUrl: plugin.bundleUrl,
      stylesUrl: plugin.stylesUrl,
      globalName: plugin.globalName || `NaapPlugin${pluginSlug.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}`,
      bundleHash: plugin.bundleHash,
    };
  }, [plugin, pluginSlug]);

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

  if (!plugin) {
    notFound();
  }

  const validationError = !plugin.enabled
    ? 'Plugin is disabled'
    : !plugin.bundleUrl
    ? 'No CDN bundle URL configured for this plugin'
    : null;

  if (validationError || status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold mt-4">Plugin Error</h2>
        <p className="text-muted-foreground mt-2">{error || validationError}</p>
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

  if (!cdnPluginInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground mt-4">Detecting plugin...</p>
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
        key={`cdn-catchall-${pluginSlug}-${retryKey}`}
        plugin={cdnPluginInfo}
        className="h-[calc(100vh-8rem)]"
        onLoad={() => setStatus('ready')}
        onError={(err) => {
          console.error(`[PluginCatchAll] CDN load failed for ${pluginSlug}:`, err);
          setError(err.message);
          setStatus('error');
        }}
      />
    </div>
  );
}
