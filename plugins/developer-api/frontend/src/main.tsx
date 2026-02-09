import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DeveloperView } from './pages/DeveloperView';
import './globals.css';

// Standalone development mode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<DeveloperView />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
