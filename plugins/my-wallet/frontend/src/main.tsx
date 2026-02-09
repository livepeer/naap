/**
 * Standalone entry point for development
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { ConnectPage } from './pages/Connect';
import { DashboardPage } from './pages/Dashboard';
import { StakingPage } from './pages/Staking';
import { TransactionsPage } from './pages/Transactions';
import { SettingsPage } from './pages/Settings';
import './globals.css';

const DevApp: React.FC = () => {
  return (
    <WalletProvider>
      <div className="min-h-screen bg-bg-primary p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-text-primary mb-6">My Wallet Plugin (Dev Mode)</h1>
          <Routes>
            <Route path="/wallet" element={<ConnectPage />} />
            <Route path="/wallet/dashboard" element={<DashboardPage />} />
            <Route path="/wallet/staking" element={<StakingPage />} />
            <Route path="/wallet/transactions" element={<TransactionsPage />} />
            <Route path="/wallet/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/wallet" replace />} />
          </Routes>
        </div>
      </div>
    </WalletProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DevApp />
    </BrowserRouter>
  </React.StrictMode>
);
