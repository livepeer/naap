import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { DashboardPage } from './pages/Dashboard';
import { LedgerPage } from './pages/Ledger';
import { AccountsPage } from './pages/Accounts';
import './globals.css';

const AgentBookCoreApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/ledger" element={<LedgerPage />} />
      <Route path="/accounts" element={<AccountsPage />} />
      <Route path="/*" element={<DashboardPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'agentbook-core',
  version: '1.0.0',
  routes: ['/agentbook', '/agentbook/*'],
  App: AgentBookCoreApp,
});

export const mount = plugin.mount;
export const unmount = plugin.unmount;
export default plugin;
