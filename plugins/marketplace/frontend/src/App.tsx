import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { MarketplacePage } from './pages/Marketplace';
import './globals.css';

const MarketplaceApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<MarketplacePage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'marketplace',
  version: '1.0.0',
  routes: ['/marketplace', '/marketplace/*'],
  App: MarketplaceApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
