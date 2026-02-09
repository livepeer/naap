import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { MarketplacePage } from './pages/Marketplace';
import './globals.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode><HashRouter><div className="min-h-screen bg-bg-primary text-text-primary p-8"><MarketplacePage /></div></HashRouter></React.StrictMode>
  );
}
