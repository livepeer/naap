/**
 * AI Leaderboard Plugin
 *
 * Displays Livepeer AI orchestrator performance data consumed via the
 * Service Gateway plugin. Frontend-only — no standalone backend needed.
 */

import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { DashboardPage } from './pages/DashboardPage';
import { PipelineDetailPage } from './pages/PipelineDetailPage';

export const LeaderboardApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/pipeline/:pipelineId" element={<PipelineDetailPage />} />
      <Route path="/*" element={<DashboardPage />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'leaderboard',
  version: '1.0.0',
  routes: ['/leaderboard', '/leaderboard/*'],
  App: LeaderboardApp,
});

export const mount = plugin.mount;
export default plugin;
