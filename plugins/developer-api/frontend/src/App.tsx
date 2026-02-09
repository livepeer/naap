import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { DeveloperView } from './pages/DeveloperView';
import './globals.css';

const DeveloperApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<DeveloperView />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'developer-api',
  version: '1.0.0',
  routes: ['/developers', '/developers/*'],
  App: DeveloperApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
