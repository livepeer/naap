import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ShellContext, WorkflowManifest } from '@naap/types';
import { AnalyticsPage } from './pages/Analytics';
import { LeaderboardPage } from './pages/Leaderboard';
import './globals.css';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const isLeaderboard = location.pathname.includes('leaderboard');
  return isLeaderboard ? <LeaderboardPage /> : <AnalyticsPage />;
};

export const manifest: WorkflowManifest = {
  name: 'network-analytics', version: '0.0.1', routes: ['/analytics', '/analytics/*', '/leaderboard', '/leaderboard/*'],
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(<React.StrictMode><MemoryRouter><Routes><Route path="/*" element={<AppRoutes />} /></Routes></MemoryRouter></React.StrictMode>);
    return () => { root.unmount(); shellContext = null; };
  },
};

export const mount = manifest.mount;
export default manifest;
