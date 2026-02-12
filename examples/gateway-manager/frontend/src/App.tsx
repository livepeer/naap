import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { GatewaysPage } from './pages/Gateways';
import './globals.css';

const GatewayApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<GatewaysPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'gateway-manager',
  version: '1.0.0',
  routes: ['/gateways', '/gateways/*'],
  App: GatewayApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
