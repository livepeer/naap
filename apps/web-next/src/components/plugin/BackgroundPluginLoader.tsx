'use client';

/**
 * BackgroundPluginLoader
 *
 * Automatically loads and mounts headless plugins (plugins with no routes)
 * on app startup. These are "provider" plugins that register event bus
 * handlers to serve data to the core UI without having their own pages.
 *
 * Example: dashboard-provider-mock registers as a dashboard data provider
 * so the /dashboard page can fetch data via the event bus.
 *
 * This component renders hidden mount containers for each headless plugin
 * and uses the standard UMD loader to load and mount them.
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { usePlugins } from '@/contexts/plugin-context';
import { useShell } from '@/contexts/shell-context';
import { loadUMDPlugin, type UMDLoadOptions } from '@/lib/plugins/umd-loader';

const TAG = '[BackgroundPluginLoader]';

export function BackgroundPluginLoader() {
  const { plugins, isLoading } = usePlugins();
  const shell = useShell();
  const mountedPlugins = useRef<Map<string, () => void>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Log raw plugin list for diagnostics
  useEffect(() => {
    console.log(`${TAG} plugins loaded (isLoading=${isLoading}, total=${plugins.length})`);
    if (plugins.length > 0) {
      const summary = plugins.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        bundleUrl: p.bundleUrl ? '✓' : '✗',
        routes: Array.isArray(p.routes) ? p.routes.length : 'n/a',
        globalName: p.globalName || 'auto',
      }));
      console.table(summary);
    }
  }, [plugins, isLoading]);

  // Find headless plugins: have a bundleUrl but no routes.
  // NOTE: We intentionally do NOT check p.enabled here. Headless plugins are
  // infrastructure-level background providers (e.g., dashboard data sources).
  // They must always load so their event bus handlers are available to the shell,
  // regardless of user/team enable/disable preferences which only apply to
  // navigable UI plugins.
  const headlessPlugins = useMemo(() => {
    const result = plugins.filter(
      (p) => p.bundleUrl && (!p.routes || p.routes.length === 0)
    );
    console.log(
      `${TAG} headless plugin candidates: ${result.length}`,
      result.map((p) => `${p.name} (enabled=${p.enabled})`),
    );
    return result;
  }, [plugins]);

  const loadPlugin = useCallback(async (plugin: typeof headlessPlugins[0]) => {
    // Skip if already mounted
    if (mountedPlugins.current.has(plugin.name)) {
      console.log(`${TAG} ${plugin.name}: already mounted, skipping`);
      return;
    }

    console.log(`${TAG} ${plugin.name}: starting load...`, {
      bundleUrl: plugin.bundleUrl,
      globalName: plugin.globalName,
    });

    try {
      // Create a hidden container for the plugin
      let container = containersRef.current.get(plugin.name);
      if (!container) {
        container = document.createElement('div');
        container.id = `bg-plugin-${plugin.name}`;
        container.style.display = 'none';
        container.setAttribute('data-plugin-container', plugin.name);
        document.body.appendChild(container);
        containersRef.current.set(plugin.name, container);
      }

      const globalName =
        plugin.globalName ||
        `NaapPlugin${plugin.name
          .split(/[-_]/)
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join('')}`;

      const options: UMDLoadOptions = {
        name: plugin.name,
        bundleUrl: plugin.bundleUrl!,
        stylesUrl: plugin.stylesUrl,
        globalName,
        bundleHash: plugin.bundleHash,
        timeout: 15000,
      };

      console.log(`${TAG} ${plugin.name}: calling loadUMDPlugin`, { globalName, bundleUrl: plugin.bundleUrl });
      const loaded = await loadUMDPlugin(options);
      console.log(`${TAG} ${plugin.name}: UMD loaded, module keys:`, Object.keys(loaded.module));

      // Build the shell context for the plugin (same pattern as PluginLoader)
      const pluginContext = {
        auth: shell.auth,
        notifications: shell.notifications,
        navigate: shell.navigate,
        eventBus: shell.eventBus,
        theme: shell.theme,
        logger: shell.logger,
        permissions: shell.permissions,
        integrations: shell.integrations,
        capabilities: shell.capabilities,
        version: '1.0.0',
        pluginBasePath: `/plugins/${plugin.name}`,
        api: shell.api,
        tenant: shell.tenant,
        team: shell.team,
      };

      // Mount the plugin
      console.log(`${TAG} ${plugin.name}: calling mount()...`);
      const cleanup = loaded.module.mount(container, pluginContext);
      const cleanupFn = typeof cleanup === 'function' ? cleanup : () => {};
      mountedPlugins.current.set(plugin.name, cleanupFn);

      console.log(`${TAG} ✅ Mounted headless plugin: ${plugin.name}`);

      // Verify: wait a tick for React effects to fire, then check event bus
      setTimeout(() => {
        try {
          // Quick smoke test: try requesting to see if handler is registered
          shell.eventBus.request('dashboard:query', { query: '{ __typename }' }, { timeout: 2000 })
            .then(() => {
              console.log(`${TAG} ✅ Verified: dashboard:query handler is responding`);
            })
            .catch((err: any) => {
              console.warn(`${TAG} ⚠ Post-mount verification: dashboard:query handler NOT responding:`, err?.code, err?.message);
            });
        } catch (e) {
          // Ignore verification errors
        }
      }, 500);
    } catch (err) {
      console.error(
        `${TAG} ❌ Failed to load headless plugin ${plugin.name}:`,
        err,
      );
    }
  }, [shell]);

  // Load headless plugins once the plugin list is ready
  useEffect(() => {
    if (isLoading) {
      console.log(`${TAG} waiting for plugin list to load...`);
      return;
    }
    if (headlessPlugins.length === 0) {
      console.log(`${TAG} no headless plugins found, nothing to load`);
      return;
    }

    console.log(`${TAG} loading ${headlessPlugins.length} headless plugins...`);
    for (const plugin of headlessPlugins) {
      loadPlugin(plugin);
    }
  }, [isLoading, headlessPlugins, loadPlugin]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [name, cleanup] of mountedPlugins.current.entries()) {
        try {
          cleanup();
          console.log(`${TAG} Unmounted headless plugin: ${name}`);
        } catch (err) {
          console.warn(`${TAG} Error unmounting ${name}:`, err);
        }
      }
      mountedPlugins.current.clear();

      // Remove hidden containers
      for (const [, container] of containersRef.current.entries()) {
        container.remove();
      }
      containersRef.current.clear();
    };
  }, []);

  // This component renders nothing visible
  return null;
}
