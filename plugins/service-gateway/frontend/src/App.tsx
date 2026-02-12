/**
 * Service Gateway Plugin — Main Entry Point
 *
 * Zero-code serverless API gateway for exposing third-party REST APIs
 * as managed, team-scoped endpoints with auth, rate limiting, and usage tracking.
 */

import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { ConnectorListPage } from './pages/ConnectorListPage';
import { ConnectorWizardPage } from './pages/ConnectorWizardPage';
import { ConnectorDetailPage } from './pages/ConnectorDetailPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { PlansPage } from './pages/PlansPage';
import './globals.css';

/**
 * Dashboard placeholder — implemented in Phase 7.
 */
const DashboardPlaceholder: React.FC = () => (
  <div className="flex items-center justify-center h-full min-h-[400px]">
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-gray-200 mb-2">Dashboard</h1>
      <p className="text-gray-400">Usage monitoring dashboard — coming in Phase 7.</p>
    </div>
  </div>
);

const GatewayApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px]">
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<ConnectorListPage />} />
        <Route path="/new" element={<ConnectorWizardPage />} />
        <Route path="/connectors/:id" element={<ConnectorDetailPage />} />
        <Route path="/connectors/:id/edit" element={<ConnectorWizardPage />} />
        <Route path="/keys" element={<ApiKeysPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/dashboard" element={<DashboardPlaceholder />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  </div>
);

const plugin = createPlugin({
  name: 'serviceGateway',
  version: '1.0.0',
  routes: ['/gateway', '/gateway/*'],
  App: GatewayApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
