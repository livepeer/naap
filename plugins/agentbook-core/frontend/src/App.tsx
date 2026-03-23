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

export default createPlugin(AgentBookCoreApp);
