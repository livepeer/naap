import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { ExpenseListPage } from './pages/ExpenseList';
import { NewExpensePage } from './pages/NewExpense';
import { ReceiptsPage } from './pages/Receipts';
import { VendorsPage } from './pages/Vendors';
import './globals.css';

const AgentbookExpenseApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<ExpenseListPage />} />
      <Route path="/new" element={<NewExpensePage />} />
      <Route path="/receipts" element={<ReceiptsPage />} />
      <Route path="/vendors" element={<VendorsPage />} />
      <Route path="/*" element={<ExpenseListPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'agentbook-expense',
  version: '1.0.0',
  routes: [
    '/agentbook/expenses',
    '/agentbook/expenses/*',
    '/agentbook/receipts',
    '/agentbook/receipts/*',
    '/agentbook/vendors',
    '/agentbook/vendors/*',
  ],
  App: AgentbookExpenseApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
