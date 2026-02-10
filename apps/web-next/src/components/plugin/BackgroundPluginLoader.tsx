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
import { createSandboxedContext } from '@/lib/plugins/sandbox';

export function BackgroundPluginLoader() {
  const { plugins, isLoading } = usePlugins();
  const shell = useShell();
  const mountedPlugins = useRef<Map<string, () => void>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Find headless plugins: enabled, have a bundleUrl, but no routes
  const headlessPlugins = useMemo(() => {
    return plugins.filter(
      (p) => p.enabled && p.bundleUrl && (!p.routes || p.routes.length === 0)
    );
  }, [plugins]);

  const loadPlugin = useCallback(async (plugin: typeof headlessPlugins[0]) => {
    // Skip if already mounted
    if (mountedPlugins.current.has(plugin.name)) return;

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

      const loaded = await loadUMDPlugin(options);

      // Build the shell context for the plugin (same pattern as PluginLoader)
      const baseContext = {
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

      const pluginContext = baseContext;

      // Mount the plugin
      const cleanup = loaded.module.mount(container, pluginContext);
      const cleanupFn = typeof cleanup === 'function' ? cleanup : () => {};
      mountedPlugins.current.set(plugin.name, cleanupFn);

      console.log(`[BackgroundPluginLoader] Mounted headless plugin: ${plugin.name}`);
    } catch (err) {
      console.warn(
        `[BackgroundPluginLoader] Failed to load headless plugin ${plugin.name}:`,
        (err as Error).message
      );
    }
  }, [shell]);

  // Load headless plugins once the plugin list is ready
  useEffect(() => {
    if (isLoading || headlessPlugins.length === 0) return;

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
          console.log(`[BackgroundPluginLoader] Unmounted headless plugin: ${name}`);
        } catch (err) {
          console.warn(`[BackgroundPluginLoader] Error unmounting ${name}:`, err);
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
