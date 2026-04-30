import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { InvoiceListPage } from './pages/InvoiceList';
import { NewInvoicePage } from './pages/NewInvoice';
import { ClientsPage } from './pages/Clients';
import { EstimatesPage } from './pages/Estimates';
import { TimerPage } from './pages/Timer';
import { ProjectsPage } from './pages/Projects';
import './globals.css';

const AgentbookInvoiceApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<InvoiceListPage />} />
      <Route path="/new" element={<NewInvoicePage />} />
      <Route path="/clients" element={<ClientsPage />} />
      <Route path="/estimates" element={<EstimatesPage />} />
      <Route path="/timer" element={<TimerPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/*" element={<InvoiceListPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'agentbook-invoice',
  version: '1.0.0',
  routes: [
    '/agentbook/invoices',
    '/agentbook/invoices/*',
    '/agentbook/clients',
    '/agentbook/clients/*',
    '/agentbook/estimates',
    '/agentbook/estimates/*',
    '/agentbook/timer',
    '/agentbook/timer/*',
    '/agentbook/projects',
    '/agentbook/projects/*',
  ],
  App: AgentbookInvoiceApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
