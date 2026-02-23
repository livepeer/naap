/**
 * Standalone Development Entry Point
 *
 * Used for independent development outside the NAAP shell.
 * Run: npm run dev
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelloPage } from './App';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelloPage />
  </React.StrictMode>
);
