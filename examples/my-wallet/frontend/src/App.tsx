/**
 * My Wallet Plugin - Main App Entry
 *
 * Tab-based architecture: Earn | Explore | Optimize | Reports
 * Settings lives in a slide-out drawer (gear icon in header)
 */

import React, { useState, useCallback } from 'react';
import { createPlugin, useShell, useNotify, useEvents, getPluginBackendUrl } from '@naap/plugin-sdk';
import { WalletProvider, useWallet } from './context/WalletContext';
import { ConnectPage } from './pages/Connect';
import { AppLayout, TabId } from './components/AppLayout';
import { EarnTab } from './tabs/EarnTab';
import { ExploreTab } from './tabs/ExploreTab';
import { OptimizeTab } from './tabs/OptimizeTab';
import { ReportsTab } from './tabs/ReportsTab';
import './globals.css';

/** Inner app that switches between connect screen and tab layout */
const AppContent: React.FC = () => {
  const { isConnected } = useWallet();
  const [activeTab, setActiveTab] = useState<TabId>('earn');

  if (!isConnected) {
    return <ConnectPage />;
  }

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'earn' && <EarnTab onNavigate={setActiveTab} />}
      {activeTab === 'explore' && <ExploreTab />}
      {activeTab === 'optimize' && <OptimizeTab />}
      {activeTab === 'reports' && <ReportsTab />}
    </AppLayout>
  );
};

// Wallet App Component -- uses SDK hooks
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
      <AppContent />
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
  return getPluginBackendUrl('my-wallet', { apiPath: '/api/v1/wallet' });
};

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
