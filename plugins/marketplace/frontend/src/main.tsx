import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MarketplacePage } from './pages/Marketplace';
import './globals.css';

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<MarketplacePage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
