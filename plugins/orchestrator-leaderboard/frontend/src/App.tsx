import React from 'react';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { TabNav } from './components/TabNav';
import { AdminSettings } from './components/AdminSettings';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { PlansOverviewPage } from './pages/PlansOverviewPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import { PlanCreatePage } from './pages/PlanCreatePage';
import './globals.css';

const ROUTE_BASE = '/orchestrator-leaderboard';

function resolveBasename(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const path = window.location.pathname;
  if (path === ROUTE_BASE || path.startsWith(`${ROUTE_BASE}/`)) {
    return ROUTE_BASE;
  }
  return null;
}

const AppRoutes: React.FC = () => (
  <>
    <AdminSettings />
    <TabNav />
    <Routes>
      <Route path="/" element={<LeaderboardPage />} />
      <Route path="/plans" element={<PlansOverviewPage />} />
      <Route path="/plans/new" element={<PlanCreatePage />} />
      <Route path="/plans/:id" element={<PlanDetailPage />} />
      <Route path="*" element={<LeaderboardPage />} />
    </Routes>
  </>
);

export const OrchestratorLeaderboardApp: React.FC = () => (
  <div className="h-full w-full min-h-[600px] text-text-primary antialiased">
    {resolveBasename() ? (
      <BrowserRouter basename={ROUTE_BASE}>
        <AppRoutes />
      </BrowserRouter>
    ) : (
      <MemoryRouter>
        <AppRoutes />
      </MemoryRouter>
    )}
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
