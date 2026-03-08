/**
 * SettingsDrawer - Slide-out settings panel (replaces Settings page)
 */

import React, { useState, useEffect } from 'react';
import { X, Globe, Zap, Eye, Bell, RefreshCw } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useAutoClaim } from '../hooks/useAutoClaim';
import { useWalletAddresses } from '../hooks/useWalletAddresses';
import { NETWORKS, NetworkId } from '../lib/contracts';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onDisconnect: () => void;
}

interface PluginSettings {
  defaultNetwork: NetworkId;
  autoConnect: boolean;
  showTestnets: boolean;
  showUsdPrices: boolean;
  gasStrategy: 'slow' | 'standard' | 'fast';
  orchestratorCacheMins: number;
}

const defaults: PluginSettings = {
  defaultNetwork: 'arbitrum-one',
  autoConnect: true,
  showTestnets: false,
  showUsdPrices: true,
  gasStrategy: 'standard',
  orchestratorCacheMins: 60,
};

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ isOpen, onClose, onDisconnect }) => {
  const { chainId, switchNetwork, isConnected } = useWallet();
  const { addresses } = useWalletAddresses();
  const primaryId = addresses.length > 0 ? addresses[0].id : undefined;
  const autoClaim = useAutoClaim(primaryId);

  const [settings, setSettings] = useState<PluginSettings>(defaults);

  useEffect(() => {
    const stored = localStorage.getItem('my-wallet-settings');
    if (stored) {
      try { setSettings({ ...defaults, ...JSON.parse(stored) }); } catch { /* ignore */ }
    }
  }, []);

  const save = (update: Partial<PluginSettings>) => {
    const next = { ...settings, ...update };
    setSettings(next);
    localStorage.setItem('my-wallet-settings', JSON.stringify(next));
  };

  if (!isOpen) return null;

  const visibleNetworks = Object.entries(NETWORKS).filter(([id]) => {
    if (settings.showTestnets) return true;
    return !id.includes('goerli');
  });

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-96 max-w-[90vw] bg-[var(--bg-primary)] border-l border-[var(--border-color)] z-50 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-bold text-text-primary">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Network */}
          <Section icon={<Globe className="w-4 h-4" />} title="Network">
            <div className="grid grid-cols-2 gap-2">
              {visibleNetworks.map(([id, network]) => (
                <button
                  key={id}
                  onClick={() => isConnected && switchNetwork(network.chainId)}
                  disabled={!isConnected || chainId === network.chainId}
                  className={`p-2.5 rounded-lg text-left text-sm transition-colors ${
                    chainId === network.chainId
                      ? 'bg-accent-purple/15 border border-accent-purple/40 text-accent-purple'
                      : 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-text-primary'
                  } disabled:opacity-50`}
                >
                  <p className="font-medium text-xs">{network.name}</p>
                </button>
              ))}
            </div>
          </Section>

          {/* Display */}
          <Section icon={<Eye className="w-4 h-4" />} title="Display">
            <Toggle
              label="Show USD prices"
              checked={settings.showUsdPrices}
              onChange={v => save({ showUsdPrices: v })}
            />
            <Toggle
              label="Show testnets"
              checked={settings.showTestnets}
              onChange={v => save({ showTestnets: v })}
            />
          </Section>

          {/* Gas */}
          <Section icon={<Zap className="w-4 h-4" />} title="Gas Strategy">
            <div className="grid grid-cols-3 gap-2">
              {(['slow', 'standard', 'fast'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => save({ gasStrategy: s })}
                  className={`p-2 rounded-lg text-center text-xs font-medium capitalize transition-colors ${
                    settings.gasStrategy === s
                      ? 'bg-accent-purple text-white'
                      : 'bg-[var(--bg-tertiary)] text-text-primary hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Section>

          {/* Auto-Claim */}
          <Section icon={<Bell className="w-4 h-4" />} title="Auto-Claim Alerts">
            <Toggle
              label="Enable claim notifications"
              checked={autoClaim.config?.enabled ?? false}
              onChange={v => autoClaim.setAutoClaimConfig(v, autoClaim.config?.minRewardLpt ?? '100000000000000000000')}
            />
            {autoClaim.config?.enabled && (
              <div className="mt-2">
                <label className="text-xs text-text-secondary">Min threshold (LPT)</label>
                <input
                  type="number"
                  defaultValue={Number(BigInt(autoClaim.config?.minRewardLpt ?? '0')) / 1e18}
                  onBlur={e => {
                    const wei = BigInt(Math.floor(parseFloat(e.target.value || '0') * 1e18)).toString();
                    autoClaim.setAutoClaimConfig(true, wei);
                  }}
                  className="w-full mt-1 p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-text-primary text-sm font-mono"
                />
              </div>
            )}
          </Section>

          {/* Data Refresh */}
          <Section icon={<RefreshCw className="w-4 h-4" />} title="Data Refresh">
            <div>
              <label className="text-xs text-text-secondary">Orchestrator cache duration (minutes)</label>
              <select
                value={settings.orchestratorCacheMins}
                onChange={e => save({ orchestratorCacheMins: Number(e.target.value) })}
                className="w-full mt-1 p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-text-primary text-sm"
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour (default)</option>
                <option value={120}>2 hours</option>
                <option value={360}>6 hours</option>
              </select>
              <p className="text-[10px] text-text-tertiary mt-1">Orchestrator list is cached locally. Lower values = more API calls.</p>
            </div>
          </Section>

          {/* Connection */}
          <Section icon={<Globe className="w-4 h-4" />} title="Connection">
            <Toggle
              label="Auto-connect on load"
              checked={settings.autoConnect}
              onChange={v => save({ autoConnect: v })}
            />
            {isConnected && (
              <button
                onClick={onDisconnect}
                className="w-full mt-3 p-2.5 text-sm text-accent-rose border border-accent-rose/30 rounded-lg hover:bg-accent-rose/10 transition-colors"
              >
                Disconnect Wallet
              </button>
            )}
          </Section>
        </div>
      </div>
    </>
  );
};

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon, title, children,
}) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <span className="text-accent-purple">{icon}</span>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label, checked, onChange,
}) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-sm text-text-secondary">{label}</span>
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-accent-purple' : 'bg-[var(--bg-tertiary)]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
        checked ? 'translate-x-5' : ''
      }`} />
    </button>
  </div>
);
