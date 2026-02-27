/**
 * Standalone/Iframe entry point for Service Gateway
 * Used during development with `vite dev`
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './globals.css';

const PlaceholderPage: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex items-center justify-center h-full min-h-[400px]">
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-gray-200 mb-2">{title}</h1>
      <p className="text-gray-400">Service Gateway — Standalone Dev Mode</p>
    </div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-white">
        <Routes>
          <Route path="/" element={<PlaceholderPage title="Service Gateway" />} />
          <Route path="/new" element={<PlaceholderPage title="New Connector" />} />
          <Route path="/keys" element={<PlaceholderPage title="API Keys" />} />
          <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
