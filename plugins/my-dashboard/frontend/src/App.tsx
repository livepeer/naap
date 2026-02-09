/**
 * My Dashboard Plugin - Main Entry Point
 */

import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { GalleryPage } from './pages/Gallery';
import { ViewerPage } from './pages/Viewer';
import { SettingsPage } from './pages/Settings';
import './globals.css';

const DashboardApp: React.FC = () => (
  <div className="space-y-6">
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/view/:id" element={<ViewerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  </div>
);

const plugin = createPlugin({
  name: 'myDashboard',
  version: '1.0.0',
  routes: ['/dashboard', '/dashboard/*'],
  App: DashboardApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

/** @deprecated Use useApiClient() hook instead */
export const getApiUrl = () => {
  const context = plugin.getContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (context && 'config' in context && (context as any).config?.apiBaseUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `${(context as any).config.apiBaseUrl}/api/v1/my-dashboard`;
  }
  return 'http://localhost:4009/api/v1/my-dashboard';
};

/** @deprecated Use useApiClient() hook instead */
export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const shell = plugin.getContext();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (shell && 'auth' in shell) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = await (shell as any).auth?.getToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
};

/** @deprecated Use useAuthService() hook instead */
export const getCurrentUser = () => {
  const shell = plugin.getContext();
  if (shell && 'auth' in shell) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (shell as any).auth?.getUser?.();
  }
  return null;
};

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
