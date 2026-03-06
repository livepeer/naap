import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import './globals.css';
import { DeploymentList } from './pages/DeploymentList';
import { DeploymentWizard } from './pages/DeploymentWizard';
import { DeploymentDetail } from './pages/DeploymentDetail';
import { ProviderSettings } from './pages/ProviderSettings';
import { AuditPage } from './pages/AuditPage';

export const DeploymentManagerApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<DeploymentList />} />
      <Route path="/new" element={<DeploymentWizard />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="/settings" element={<ProviderSettings />} />
      <Route path="/:id" element={<DeploymentDetail />} />
      <Route path="/*" element={<DeploymentList />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'deployment-manager',
  version: '1.0.0',
  routes: ['/deployments', '/deployments/*'],
  App: DeploymentManagerApp,
});

export const mount = plugin.mount;
export default plugin;
