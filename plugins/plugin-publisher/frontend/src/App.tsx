/**
 * Plugin Publisher - Publish and Manage Your Plugins
 */

import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin, getPluginBackendUrl } from '@naap/plugin-sdk';
import './globals.css';

// Import pages
import { Dashboard } from './pages/Dashboard';
import { MyPlugins } from './pages/MyPlugins';
import { PublishWizard } from './pages/PublishWizard';
import { PluginDetail } from './pages/PluginDetail';
import { ApiTokens } from './pages/ApiTokens';
import { Settings } from './pages/Settings';
import { ExamplePlugins } from './pages/ExamplePlugins';

// Import shared shell context module (backward compat)
import {
  getShellContext as getContext,
  setShellContext,
  getAuthToken,
  isAuthenticated,
  notify
} from './lib/shell-context';

const PluginRoutes: React.FC = () => (
  <div className="space-y-6">
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/plugins" element={<MyPlugins />} />
        <Route path="/plugins/:name" element={<PluginDetail />} />
        <Route path="/new" element={<PublishWizard />} />
        <Route path="/tokens" element={<ApiTokens />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/examples" element={<ExamplePlugins />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  </div>
);

const plugin = createPlugin({
  name: 'pluginPublisher',
  version: '1.0.0',
  routes: ['/publish', '/publish/*'],
  App: PluginRoutes,
  onMount: (context) => {
    // Keep shell-context module in sync for backward compat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setShellContext(context as any);
  },
  onUnmount: () => {
    setShellContext(null);
  },
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

// Re-export for backwards compatibility with pages
export { getAuthToken, isAuthenticated, notify };

/** @deprecated Use useApiClient({ pluginName: 'plugin-publisher' }) instead */
export const getApiUrl = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = plugin.getContext() as any;
  if (context?.config?.apiBaseUrl) {
    return `${context.config.apiBaseUrl}/api/v1/plugins`;
  }
  return getPluginBackendUrl('plugin-publisher', { apiPath: '/api/v1/plugins' });
};

/** @deprecated Use useApiClient() hook instead */
export const getAuthHeaders = (): Record<string, string> => {
  const shell = plugin.getContext();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (shell && 'auth' in shell) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (shell as any).auth?.getToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
};

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
