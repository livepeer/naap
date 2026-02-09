/**
 * My Wallet Plugin - Main App Entry
 */

import React, { useCallback } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { createPlugin, useShell, useNotify, useEvents } from '@naap/plugin-sdk';
import type { ShellContext } from '@naap/plugin-sdk';
import { WalletProvider } from './context/WalletContext';
import { ConnectPage } from './pages/Connect';
import { DashboardPage } from './pages/Dashboard';
import { StakingPage } from './pages/Staking';
import { TransactionsPage } from './pages/Transactions';
import { SettingsPage } from './pages/Settings';
import './globals.css';

// Wallet App Component -- now uses SDK hooks instead of getShellContext()
const WalletApp: React.FC = () => {
  const shell = useShell();
  const notifications = useNotify();
  const eventBus = useEvents();

  const handleConnect = useCallback(async (address: string, chainId: number) => {
    const userId = shell.auth.getUser()?.id;

    eventBus.emit('wallet:connected', { address, chainId, userId });
    console.log('Wallet connected:', address, 'on chain', chainId, 'userId:', userId);

    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      await fetch(`${apiUrl}/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: userId || address,
          address,
          chainId,
        }),
      });
      notifications.success('Wallet connected successfully');
    } catch (err) {
      console.error('Failed to save wallet connection:', err);
      notifications.error('Failed to link wallet to account');
    }
  }, [shell, notifications, eventBus]);

  const handleDisconnect = useCallback(() => {
    eventBus.emit('wallet:disconnected', {});
    notifications.info('Wallet disconnected');
  }, [eventBus, notifications]);

  return (
    <WalletProvider onConnect={handleConnect} onDisconnect={handleDisconnect}>
      <div className="space-y-6">
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<ConnectPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/staking" element={<StakingPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MemoryRouter>
      </div>
    </WalletProvider>
  );
};

const plugin = createPlugin({
  name: 'my-wallet',
  version: '1.0.0',
  routes: ['/wallet', '/wallet/*'],
  App: WalletApp,
});

/** @deprecated Use useShell() / useApiClient() hooks instead */
export const getShellContext = plugin.getContext;

/** @deprecated Use useApiClient({ pluginName: 'my-wallet' }) instead */
export const getApiUrl = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context = plugin.getContext() as any;
  if (context?.config?.apiBaseUrl) {
    return `${context.config.apiBaseUrl}/api/v1/wallet`;
  }
  return 'http://localhost:4008/api/v1/wallet';
};

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
