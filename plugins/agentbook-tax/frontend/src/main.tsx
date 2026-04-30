import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TaxDashboardPage } from './pages/TaxDashboard';
import './globals.css';

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<TaxDashboardPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
