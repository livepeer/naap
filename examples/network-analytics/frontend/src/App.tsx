import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { RawExplorerPage } from './pages/RawExplorer';
import './globals.css';

const AnalyticsApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<RawExplorerPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'network-analytics',
  version: '1.0.0',
  routes: ['/analytics', '/analytics/*'],
  App: AnalyticsApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
