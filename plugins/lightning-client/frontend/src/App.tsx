import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { Studio } from './pages/Studio';

export const LightningClientApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<Studio />} />
      <Route path="/*" element={<Studio />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'lightning-client',
  version: '1.0.0',
  routes: ['/lightning-client', '/lightning-client/*'],
  App: LightningClientApp,
});

export const mount = plugin.mount;
export default plugin;
