import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GatewaysPage } from './pages/Gateways';
import './globals.css';

// Standalone entry point for development
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-bg-primary p-8">
        <GatewaysPage />
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
