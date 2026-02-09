/**
 * Standalone development entry point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GalleryPage } from './pages/Gallery';
import { ViewerPage } from './pages/Viewer';
import { SettingsPage } from './pages/Settings';
import './globals.css';

// Mock shell context for standalone development
(window as any).__SHELL_CONTEXT__ = {
  config: {
    apiBaseUrl: 'http://localhost:4009',
  },
  theme: { current: 'dark' },
  notifications: {
    success: (msg: string) => console.log('✅', msg),
    error: (msg: string) => console.error('❌', msg),
    info: (msg: string) => console.info('ℹ️', msg),
  },
  eventBus: {
    emit: (event: string, data: any) => console.log('Event:', event, data),
    on: () => () => {},
  },
};

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6">
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/view/:id" element={<ViewerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
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
