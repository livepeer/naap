/**
 * Daydream AI Video Plugin - Main Entry Point
 *
 * Note: API URL and auth handling moved to lib/api.ts
 * This file only handles React component mounting via createPlugin.
 */

import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { Studio } from './pages/Studio';
import { Settings } from './pages/Settings';
import './globals.css';

const DaydreamApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px]">
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Studio />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  </div>
);

const plugin = createPlugin({
  name: 'daydreamVideo',
  version: '1.0.0',
  routes: ['/daydream', '/daydream/*'],
  App: DaydreamApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = (plugin as any).getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
