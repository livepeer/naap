import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { GatewaysPage } from './pages/Gateways';
import './globals.css';

// Standalone development mode
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <HashRouter>
        <div className="min-h-screen bg-bg-primary text-text-primary p-8">
          <GatewaysPage />
        </div>
      </HashRouter>
    </React.StrictMode>
  );
}
