import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnalyticsPage } from './pages/Analytics';
import { LeaderboardPage } from './pages/Leaderboard';
import './globals.css';

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/leaderboard/*" element={<LeaderboardPage />} />
        <Route path="/*" element={<AnalyticsPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
