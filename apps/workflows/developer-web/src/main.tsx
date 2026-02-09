import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DeveloperView } from './pages/DeveloperView';
import './globals.css';

// Standalone dev mode entry point
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-bg-primary p-8">
        <Routes>
          <Route path="/*" element={<DeveloperView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
