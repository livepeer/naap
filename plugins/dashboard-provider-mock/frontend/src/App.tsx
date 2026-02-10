/**
 * Dashboard Provider Mock — Plugin Entry
 *
 * This is a headless plugin (no UI routes, no navigation).
 * It registers as a dashboard data provider on mount and
 * cleans up on unmount.
 */

import React, { useEffect, useRef } from 'react';
import { createPlugin, useShell } from '@naap/plugin-sdk';
import { registerMockDashboardProvider } from './provider.js';
import { registerMockJobFeedEmitter } from './job-feed-emitter.js';

/**
 * Headless provider component that registers event bus handlers.
 * Renders nothing — all work happens in useEffect.
 */
const DashboardProviderApp: React.FC = () => {
  const shell = useShell();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Register both providers
    const cleanupProvider = registerMockDashboardProvider(shell.eventBus);
    const cleanupJobFeed = registerMockJobFeedEmitter(shell.eventBus);

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

  // Headless — render nothing
  return null;
};

const plugin = createPlugin({
  name: 'dashboard-provider-mock',
  version: '1.0.0',
  routes: [], // No UI routes — headless provider
  App: DashboardProviderApp,
});

export const mount = plugin.mount;
export default plugin;
