import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CapacityPage } from './pages/Capacity';
import './globals.css';

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<CapacityPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
