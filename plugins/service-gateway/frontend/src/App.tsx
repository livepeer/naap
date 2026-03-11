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
import { MasterKeysPage } from './pages/MasterKeysPage';
import { PlansPage } from './pages/PlansPage';
import { DashboardPage } from './pages/DashboardPage';
import { GatewayNav } from './components/GatewayNav';
import './globals.css';

const GatewayApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px] flex">
    <MemoryRouter>
      <GatewayNav />
      <div className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<ConnectorListPage />} />
          <Route path="/new" element={<ConnectorWizardPage />} />
          <Route path="/connectors/:id" element={<ConnectorDetailPage />} />
          <Route path="/connectors/:id/edit" element={<ConnectorWizardPage />} />
          <Route path="/keys" element={<ApiKeysPage />} />
          <Route path="/master-keys" element={<MasterKeysPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
