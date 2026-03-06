/**
 * Standalone/Iframe entry point for Service Gateway
 * Used during development with `vite dev`
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConnectorListPage } from './pages/ConnectorListPage';
import { ConnectorDetailPage } from './pages/ConnectorDetailPage';
import { ConnectorWizardPage } from './pages/ConnectorWizardPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { PlansPage } from './pages/PlansPage';
import { DashboardPage } from './pages/DashboardPage';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-white">
        <Routes>
          <Route path="/" element={<ConnectorListPage />} />
          <Route path="/new" element={<ConnectorWizardPage />} />
          <Route path="/connectors/:id" element={<ConnectorDetailPage />} />
          <Route path="/keys" element={<ApiKeysPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
