/**
 * Standalone/Iframe development entry point
 * Handles both standalone mode and iframe embedding from shell
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { MyPlugins } from './pages/MyPlugins';
import { PublishWizard } from './pages/PublishWizard';
import { PluginDetail } from './pages/PluginDetail';
import { ApiTokens } from './pages/ApiTokens';
import { Settings } from './pages/Settings';
import './globals.css';

// Check if we're in an iframe (embedded in shell)
const isInIframe = window.parent !== window;

// Apply theme to document
function applyTheme(mode: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.body.classList.toggle('dark', mode === 'dark');
}

// Default to dark theme (matches shell default)
applyTheme('dark');

// Allowed origins for shell messages (same-origin + configured parent origins)
const ALLOWED_MESSAGE_ORIGINS: string[] = [
  window.location.origin,
  ...(import.meta.env.VITE_ALLOWED_MESSAGE_ORIGINS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
];

// Listen for shell:init message when in iframe
if (isInIframe) {
  window.addEventListener('message', (event) => {
    // Verify message origin to prevent cross-origin attacks
    if (!ALLOWED_MESSAGE_ORIGINS.includes(event.origin)) return;

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
        theme: { mode: themeMode, current: themeMode },
      };

      // Notify shell that we're ready (use validated origin, not wildcard)
      window.parent.postMessage({ type: 'plugin:ready' }, event.origin);
    }

    if (type === 'shell:theme') {
      const themeMode = event.data.mode === 'dark' ? 'dark' : 'light';
      applyTheme(themeMode);
    }
  });
}

// Mock shell context for standalone development
if (!(window as any).__SHELL_CONTEXT__) {
  (window as any).__SHELL_CONTEXT__ = {
    config: {
      apiBaseUrl: 'http://localhost:4011',
    },
    theme: { mode: 'dark', current: 'dark' },
    notifications: {
      success: (msg: string) => console.log('✅', msg),
      error: (msg: string) => console.error('❌', msg),
      info: (msg: string) => console.info('ℹ️', msg),
      warning: (msg: string) => console.warn('⚠️', msg),
    },
    eventBus: {
      emit: (event: string, data: any) => console.log('Event:', event, data),
      on: () => () => {},
    },
  };
}

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/plugins" element={<MyPlugins />} />
        <Route path="/plugins/:name" element={<PluginDetail />} />
        <Route path="/new" element={<PublishWizard />} />
        <Route path="/tokens" element={<ApiTokens />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </React.StrictMode>
);
