/**
 * Dashboard Data Provider — Plugin Entry
 *
 * This is a headless plugin (no UI routes, no navigation).
 * It registers as a dashboard data provider on mount and
 * cleans up on unmount.
 */

import React, { useEffect, useRef } from 'react';
import { createPlugin, useShell } from '@naap/plugin-sdk';
import { registerDashboardProvider } from './provider.js';
import { registerJobFeedEmitter } from './job-feed-emitter.js';

/**
 * Headless provider component that registers event bus handlers.
 * Renders nothing — all work happens in useEffect.
 */
const DashboardProviderApp: React.FC = () => {
  const shell = useShell();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const cleanupProvider = registerDashboardProvider(shell.eventBus);
    const cleanupJobFeed = registerJobFeedEmitter(shell.eventBus);

    cleanupRef.current = () => {
      cleanupProvider();
      cleanupJobFeed();
    };

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [shell.eventBus]);

  return null;
};

const plugin = createPlugin({
  name: 'dashboard-data-provider',
  version: '1.0.0',
  routes: [],
  App: DashboardProviderApp,
});

export const mount = plugin.mount;
export default plugin;
