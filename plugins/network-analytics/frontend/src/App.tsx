import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { AnalyticsPage } from './pages/Analytics';
import { LeaderboardPage } from './pages/Leaderboard';
import './globals.css';

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const isLeaderboard = location.pathname.includes('leaderboard');
  return isLeaderboard ? <LeaderboardPage /> : <AnalyticsPage />;
};

const AnalyticsApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<AppRoutes />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'network-analytics',
  version: '1.0.0',
  routes: ['/analytics', '/analytics/*', '/leaderboard', '/leaderboard/*'],
  App: AnalyticsApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
