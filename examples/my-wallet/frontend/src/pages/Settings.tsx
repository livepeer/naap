/**
 * Settings Page - Plugin configuration
 */

import React, { useState, useEffect } from 'react';
import { Settings, Globe, Zap, Eye, RefreshCw, Save, CheckCircle, Shield } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { NETWORKS, NetworkId } from '../lib/contracts';

interface PluginSettings {
  defaultNetwork: NetworkId;
  autoConnect: boolean;
  showTestnets: boolean;
  gasStrategy: 'slow' | 'standard' | 'fast';
}

const defaultSettings: PluginSettings = {
  defaultNetwork: 'arbitrum-one',
  autoConnect: true,
  showTestnets: false,
  gasStrategy: 'standard',
};

export const SettingsPage: React.FC = () => {
  const { isConnected, chainId, switchNetwork, networkName, disconnect } = useWallet();
  const { isAdmin } = usePermissions();
  const [settings, setSettings] = useState<PluginSettings>(defaultSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('my-wallet-settings');
    if (stored) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(stored) });
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);

    try {
      localStorage.setItem('my-wallet-settings', JSON.stringify(settings));
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate save
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNetworkSwitch = async (networkId: NetworkId) => {
    const network = NETWORKS[networkId];
    if (network && isConnected) {
      try {
        await switchNetwork(network.chainId);
      } catch (err) {
        console.error('Failed to switch network:', err);
      }
    }
  };

  const visibleNetworks = Object.entries(NETWORKS).filter(([id]) => {
    if (settings.showTestnets) return true;
    return !id.includes('goerli');
  });

  return (
    <div className="space-y-6">
      {/* Header with Back Navigation */}
      <PageHeader
        title="Wallet Settings"
        subtitle="Configure your wallet preferences"
        actions={
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-accent-purple text-white rounded-lg font-medium hover:bg-accent-purple/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        }
      />

      {/* Network Settings */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="w-5 h-5 text-accent-purple" />
          <h2 className="text-lg font-semibold text-text-primary">Network</h2>
        </div>

        <div className="space-y-4">
          {/* Current Network */}
          {isConnected && (
            <div className="p-4 bg-bg-tertiary rounded-lg">
              <p className="text-sm text-text-secondary mb-1">Currently Connected</p>
              <p className="font-semibold text-accent-emerald">{networkName || `Chain ${chainId}`}</p>
            </div>
          )}

          {/* Network List */}
          <div>
            <p className="text-sm text-text-secondary mb-2">Switch Network</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleNetworks.map(([id, network]) => (
                <button
                  key={id}
                  onClick={() => handleNetworkSwitch(id as NetworkId)}
                  disabled={!isConnected || chainId === network.chainId}
                  className={`p-3 rounded-lg text-left transition-colors ${
                    chainId === network.chainId
                      ? 'bg-accent-purple/20 border border-accent-purple/50'
                      : 'bg-bg-tertiary hover:bg-bg-secondary'
                  } disabled:opacity-50`}
                >
                  <p className="font-medium text-text-primary">{network.name}</p>
                  <p className="text-xs text-text-secondary">Chain ID: {network.chainId}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Show Testnets Toggle */}
          <div className="flex items-center justify-between p-4 bg-bg-tertiary rounded-lg">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-text-secondary" />
              <div>
                <p className="font-medium text-text-primary">Show Testnets</p>
                <p className="text-sm text-text-secondary">Display testnet networks in the list</p>
              </div>
            </div>
            <Toggle
              checked={settings.showTestnets}
              onChange={checked => setSettings(prev => ({ ...prev, showTestnets: checked }))}
            />
          </div>
        </div>
      </div>

      {/* Connection Settings */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Zap className="w-5 h-5 text-accent-purple" />
          <h2 className="text-lg font-semibold text-text-primary">Connection</h2>
        </div>

        <div className="space-y-4">
          {/* Auto Connect Toggle */}
          <div className="flex items-center justify-between p-4 bg-bg-tertiary rounded-lg">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-text-secondary" />
              <div>
                <p className="font-medium text-text-primary">Auto Connect</p>
                <p className="text-sm text-text-secondary">Automatically connect wallet on page load</p>
              </div>
            </div>
            <Toggle
              checked={settings.autoConnect}
              onChange={checked => setSettings(prev => ({ ...prev, autoConnect: checked }))}
            />
          </div>

          {/* Disconnect Button */}
          {isConnected && (
            <button
              onClick={disconnect}
              className="w-full p-3 text-accent-rose border border-accent-rose/30 rounded-lg hover:bg-accent-rose/10 transition-colors"
            >
              Disconnect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Gas Settings */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-5 h-5 text-accent-purple" />
          <h2 className="text-lg font-semibold text-text-primary">Gas Settings</h2>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Default gas price strategy for transactions</p>
          <div className="grid grid-cols-3 gap-3">
            {(['slow', 'standard', 'fast'] as const).map(strategy => (
              <button
                key={strategy}
                onClick={() => setSettings(prev => ({ ...prev, gasStrategy: strategy }))}
                className={`p-4 rounded-lg text-center transition-colors ${
                  settings.gasStrategy === strategy
                    ? 'bg-accent-purple text-white'
                    : 'bg-bg-tertiary hover:bg-bg-secondary text-text-primary'
                }`}
              >
                <p className="font-semibold capitalize">{strategy}</p>
                <p className="text-xs opacity-75">
                  {strategy === 'slow' && '~5 min'}
                  {strategy === 'standard' && '~2 min'}
                  {strategy === 'fast' && '~30 sec'}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Admin-Only Section */}
      {isAdmin && (
        <div className="glass-card p-6 border-accent-amber/30">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-5 h-5 text-accent-amber" />
            <h2 className="text-lg font-semibold text-text-primary">Admin Settings</h2>
            <span className="text-xs bg-accent-amber/20 text-accent-amber px-2 py-0.5 rounded-full">
              Admin Only
            </span>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              These settings are only visible to wallet administrators.
            </p>
            
            <div className="p-4 bg-bg-tertiary rounded-lg space-y-3">
              <h3 className="font-medium text-text-primary">Staking Limits</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-text-secondary">Min Stake (LPT)</label>
                  <input
                    type="number"
                    defaultValue="1"
                    className="w-full mt-1 p-2 bg-bg-secondary border border-white/10 rounded-lg text-text-primary"
                    disabled
                  />
                </div>
                <div>
                  <label className="text-sm text-text-secondary">Max Stake (LPT)</label>
                  <input
                    type="number"
                    defaultValue="1000000"
                    className="w-full mt-1 p-2 bg-bg-secondary border border-white/10 rounded-lg text-text-primary"
                    disabled
                  />
                </div>
              </div>
              <p className="text-xs text-text-secondary">
                * Staking limits are configured at the contract level
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Toggle Component
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative w-12 h-6 rounded-full transition-colors ${
      checked ? 'bg-accent-purple' : 'bg-bg-tertiary'
    }`}
  >
    <span
      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
        checked ? 'translate-x-6' : ''
      }`}
    />
  </button>
);
