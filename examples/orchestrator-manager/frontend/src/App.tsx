import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { OrchestratorsPage } from './pages/Orchestrators';
import './globals.css';

const OrchestratorApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<OrchestratorsPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'orchestrator-manager',
  version: '1.0.0',
  routes: ['/orchestrators', '/orchestrators/*'],
  App: OrchestratorApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
