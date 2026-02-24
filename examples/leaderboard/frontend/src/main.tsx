/**
 * Standalone Development Entry Point
 *
 * Used for independent development outside the NaaP shell.
 * Run: npm run dev
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { LeaderboardApp } from './App';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LeaderboardApp />
  </React.StrictMode>,
);
