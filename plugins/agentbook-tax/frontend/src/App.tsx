import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { TaxDashboardPage } from './pages/TaxDashboard';
import { QuarterlyPage } from './pages/Quarterly';
import { DeductionsPage } from './pages/Deductions';
import { ReportsPage } from './pages/Reports';
import { CashFlowPage } from './pages/CashFlow';
import './globals.css';

const AgentbookTaxApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<TaxDashboardPage />} />
      <Route path="/quarterly" element={<QuarterlyPage />} />
      <Route path="/deductions" element={<DeductionsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/cashflow" element={<CashFlowPage />} />
      <Route path="/*" element={<TaxDashboardPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'agentbook-tax',
  version: '1.0.0',
  routes: [
    '/agentbook/tax',
    '/agentbook/tax/*',
    '/agentbook/reports',
    '/agentbook/reports/*',
    '/agentbook/cashflow',
    '/agentbook/cashflow/*',
  ],
  App: AgentbookTaxApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
