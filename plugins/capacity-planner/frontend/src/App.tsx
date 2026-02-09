import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { CapacityPage } from './pages/Capacity';
import './globals.css';

const CapacityApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<CapacityPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'capacity-planner',
  version: '1.0.0',
  routes: ['/capacity', '/capacity/*'],
  App: CapacityApp,
});

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
