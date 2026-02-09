import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AnalyticsPage } from './pages/Analytics';
import { LeaderboardPage } from './pages/Leaderboard';
import './globals.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <HashRouter>
        <div className="min-h-screen bg-bg-primary text-text-primary p-8">
          <Routes>
            <Route path="/" element={<AnalyticsPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Routes>
        </div>
      </HashRouter>
    </React.StrictMode>
  );
}
