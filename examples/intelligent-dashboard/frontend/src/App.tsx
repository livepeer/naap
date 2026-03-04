import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { ChatPage } from './pages/ChatPage';

export const IntelligentDashboardApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/*" element={<ChatPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'intelligent-dashboard',
  version: '1.0.0',
  routes: ['/intelligent-dashboard', '/intelligent-dashboard/*'],
  App: IntelligentDashboardApp,
});

export const mount = plugin.mount;
export default plugin;
