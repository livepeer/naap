/**
 * AppLayout - Persistent shell with header + tab navigation
 * Replaces the route-based navigation with a clear tab structure:
 *   Earn | Explore | Optimize | Reports
 */

import React, { useState } from 'react';
import { Wallet, TrendingUp, Search, Sliders, FileText, Settings, Bell, ChevronDown, Check } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useAlerts } from '../hooks/useAlerts';
import { formatAddress } from '../lib/utils';
import { SettingsDrawer } from './SettingsDrawer';

export type TabId = 'earn' | 'explore' | 'optimize' | 'reports';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'earn', label: 'Earn', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'explore', label: 'Explore', icon: <Search className="w-4 h-4" /> },
  { id: 'optimize', label: 'Optimize', icon: <Sliders className="w-4 h-4" /> },
  { id: 'reports', label: 'Reports', icon: <FileText className="w-4 h-4" /> },
];

interface AppLayoutProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ activeTab, onTabChange, children }) => {
  const { address, accounts, networkName, disconnect, switchAccount } = useWallet();
  const alerts = useAlerts();
  const [showSettings, setShowSettings] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  return (
    <div className="min-h-[500px] flex flex-col">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg wallet-gradient flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-primary leading-tight">LPT Earn</h1>
            <p className="text-[11px] text-text-tertiary">Stake & earn on Livepeer</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Alerts */}
          <div className="relative">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors relative"
              aria-label="Alerts"
            >
              <Bell className="w-4 h-4 text-text-secondary" />
              {alerts.unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-rose px-1 text-[9px] font-bold text-white">
                  {alerts.unreadCount > 9 ? '9+' : alerts.unreadCount}
                </span>
              )}
            </button>
            {showAlerts && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl z-50">
                <div className="p-3 border-b border-[var(--border-color)]">
                  <h4 className="text-xs font-semibold text-text-primary">Notifications</h4>
                </div>
                {alerts.history.length === 0 ? (
                  <div className="p-6 text-center text-text-tertiary text-xs">No notifications</div>
                ) : (
                  <div className="divide-y divide-[var(--border-color)]">
                    {alerts.history.slice(0, 8).map(item => (
                      <div key={item.id} className="p-3 hover:bg-[var(--bg-tertiary)] transition-colors">
                        <p className="text-xs text-text-primary leading-snug">{item.message}</p>
                        <p className="text-[10px] text-text-tertiary mt-1">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Wallet Address / Account Picker */}
          <div className="relative">
            <button
              onClick={() => accounts.length > 1 ? setShowAccountPicker(!showAccountPicker) : undefined}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] ${
                accounts.length > 1 ? 'cursor-pointer hover:bg-[var(--bg-tertiary)]/80' : ''
              }`}
            >
              <div className="w-2 h-2 rounded-full bg-accent-emerald" />
              <span className="text-xs font-mono text-text-primary">{formatAddress(address || '', 4)}</span>
              {accounts.length > 1 && (
                <span className="text-[9px] text-text-tertiary bg-[var(--border-color)] px-1 rounded">{accounts.length}</span>
              )}
              <span className="text-[10px] text-text-tertiary">{networkName || ''}</span>
              {accounts.length > 1 && <ChevronDown className="w-3 h-3 text-text-tertiary" />}
            </button>

            {showAccountPicker && accounts.length > 1 && (
              <div className="absolute right-0 top-full mt-1 w-64 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl z-50">
                <div className="p-2 border-b border-[var(--border-color)]">
                  <p className="text-[10px] text-text-tertiary font-semibold uppercase">Switch Account</p>
                </div>
                {accounts.map(acc => {
                  const isActive = acc.toLowerCase() === address?.toLowerCase();
                  return (
                    <button
                      key={acc}
                      onClick={async () => {
                        if (!isActive) await switchAccount(acc);
                        setShowAccountPicker(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-accent-emerald' : 'bg-[var(--border-color)]'}`} />
                      <span className="text-xs font-mono text-text-primary flex-1 text-left">{formatAddress(acc, 6)}</span>
                      {isActive && <Check className="w-3 h-3 text-accent-emerald" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Settings Gear */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4 text-text-secondary" />
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="flex border-b border-[var(--border-color)] px-6" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent-emerald text-accent-emerald'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-[var(--border-color)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        {children}
      </main>

      {/* Settings Drawer */}
      <SettingsDrawer
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onDisconnect={disconnect}
      />
    </div>
  );
};
