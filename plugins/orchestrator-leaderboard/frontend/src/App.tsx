import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { TabNav } from './components/TabNav';
import { AdminSettings } from './components/AdminSettings';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { PlansOverviewPage } from './pages/PlansOverviewPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import './globals.css';

export const OrchestratorLeaderboardApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px]">
    <MemoryRouter>
      <AdminSettings />
      <TabNav />
      <Routes>
        <Route path="/" element={<LeaderboardPage />} />
        <Route path="/plans" element={<PlansOverviewPage />} />
        <Route path="/plans/:id" element={<PlanDetailPage />} />
        <Route path="/*" element={<LeaderboardPage />} />
      </Routes>
    </MemoryRouter>
  </div>
);

const plugin = createPlugin({
  name: 'orchestrator-leaderboard',
  version: '1.0.0',
  routes: ['/orchestrator-leaderboard', '/orchestrator-leaderboard/*'],
  App: OrchestratorLeaderboardApp,
});

export const mount = plugin.mount;
export default plugin;
