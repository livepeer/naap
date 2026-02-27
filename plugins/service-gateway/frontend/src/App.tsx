/**
 * Service Gateway Plugin — Main Entry Point
 *
 * Zero-code serverless API gateway for exposing third-party REST APIs
 * as managed, team-scoped endpoints with auth, rate limiting, and usage tracking.
 */

import React from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import './globals.css';

/**
 * Placeholder pages — implemented in Phase 6 and 7.
 */
const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex items-center justify-center h-full min-h-[400px]">
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-gray-200 mb-2">{title}</h1>
      <p className="text-gray-400">Coming soon — Service Gateway plugin is being set up.</p>
    </div>
  </div>
);

const GatewayApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px]">
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<PlaceholderPage title="Service Gateway" />} />
        <Route path="/new" element={<PlaceholderPage title="New Connector" />} />
        <Route path="/connectors/:id" element={<PlaceholderPage title="Connector Detail" />} />
        <Route path="/connectors/:id/edit" element={<PlaceholderPage title="Edit Connector" />} />
        <Route path="/keys" element={<PlaceholderPage title="API Keys" />} />
        <Route path="/plans" element={<PlaceholderPage title="Plans" />} />
        <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
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
