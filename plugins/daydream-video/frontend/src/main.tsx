/**
 * Standalone/Iframe entry point for Daydream AI Video
 * Handles both standalone mode and iframe embedding from shell
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Studio } from './pages/Studio';
import { Settings } from './pages/Settings';
import './globals.css';

// Check if we're in an iframe (embedded in shell)
const isInIframe = window.parent !== window;

// Apply theme to document
function applyTheme(mode: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.body.classList.toggle('dark', mode === 'dark');
}

// Default to dark theme
applyTheme('dark');

// Listen for shell:init message when in iframe
if (isInIframe) {
  window.addEventListener('message', (event) => {
    // Verify message origin to prevent cross-origin attacks
    if (event.origin !== window.location.origin) return;

    const { type, context } = event.data || {};

    if (type === 'shell:init') {
      // Apply theme from shell
      const themeMode = context?.theme === 'dark' || context?.theme === 'light'
        ? context.theme
        : 'dark';
      applyTheme(themeMode);

      // Store context for API calls
      (window as any).__SHELL_CONTEXT__ = {
        ...context,
        theme: { mode: themeMode },
      };

      // Notify shell that we're ready
      window.parent.postMessage({ type: 'plugin:ready' }, '*');
    }

    if (type === 'shell:theme') {
      const themeMode = event.data.mode === 'dark' ? 'dark' : 'light';
      applyTheme(themeMode);
    }
  });
}

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-bg-primary text-text-primary">
        <Routes>
          <Route path="/" element={<Studio />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
