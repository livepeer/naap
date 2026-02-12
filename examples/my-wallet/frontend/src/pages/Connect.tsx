/**
 * Connect Page - Wallet connection UI
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, AlertCircle, ExternalLink, ChevronRight } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { formatAddress } from '../lib/utils';

export const ConnectPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    isConnected, 
    isConnecting, 
    address, 
    chainId, 
    networkName,
    error, 
    connect,
    isMetaMaskInstalled,
    isSupportedNetwork,
  } = useWallet();

  // If connected, show quick actions
  if (isConnected && address) {
    return (
      <div className="space-y-6">
        {/* Connected Status */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full wallet-gradient flex items-center justify-center">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Connected Wallet</p>
                <p className="text-lg font-semibold text-text-primary font-mono">
                  {formatAddress(address, 6)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-text-secondary">Network</p>
              <p className={`text-sm font-medium ${isSupportedNetwork ? 'text-accent-emerald' : 'text-accent-amber'}`}>
                {networkName || `Chain ${chainId}`}
              </p>
            </div>
          </div>

          {!isSupportedNetwork && (
            <div className="mt-4 p-3 bg-accent-amber/10 border border-accent-amber/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-accent-amber flex-shrink-0" />
              <p className="text-sm text-accent-amber">
                Please switch to a supported network (Ethereum or Arbitrum)
              </p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickActionCard
            title="Dashboard"
            description="View balances and activity"
            onClick={() => navigate('/dashboard')}
          />
          <QuickActionCard
            title="Staking"
            description="Stake LPT to orchestrators"
            onClick={() => navigate('/staking')}
          />
          <QuickActionCard
            title="Transactions"
            description="View transaction history"
            onClick={() => navigate('/transactions')}
          />
          <QuickActionCard
            title="Settings"
            description="Configure wallet preferences"
            onClick={() => navigate('/settings')}
          />
        </div>
      </div>
    );
  }

  // Not connected - show connect UI
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-8">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full wallet-gradient flex items-center justify-center">
          <Wallet className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Connect Your Wallet</h1>
        <p className="text-text-secondary max-w-md">
          Connect your MetaMask wallet to stake LPT, view transactions, and interact with the Livepeer network.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-accent-rose/10 border border-accent-rose/30 rounded-lg flex items-center gap-3 max-w-md">
          <AlertCircle className="w-5 h-5 text-accent-rose flex-shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {!isMetaMaskInstalled ? (
        <div className="space-y-4 text-center">
          <p className="text-text-secondary">MetaMask is not installed</p>
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-accent-purple text-white rounded-lg font-semibold hover:bg-accent-purple/90 transition-colors"
          >
            Install MetaMask
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      ) : (
        <button
          onClick={connect}
          disabled={isConnecting}
          className="px-8 py-4 wallet-gradient text-white rounded-xl font-semibold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
        >
          {isConnecting ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet className="w-5 h-5" />
              Connect MetaMask
            </>
          )}
        </button>
      )}

      <p className="text-xs text-text-secondary text-center max-w-sm">
        By connecting your wallet, you agree to the Terms of Service and acknowledge that you understand the risks involved in staking.
      </p>
    </div>
  );
};

// Quick Action Card Component
interface QuickActionCardProps {
  title: string;
  description: string;
  onClick: () => void;
}

const QuickActionCard: React.FC<QuickActionCardProps> = ({ title, description, onClick }) => (
  <button
    onClick={onClick}
    className="glass-card p-5 text-left hover:border-accent-purple/50 transition-colors group"
  >
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-semibold text-text-primary group-hover:text-accent-purple transition-colors">
          {title}
        </h3>
        <p className="text-sm text-text-secondary mt-1">{description}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-text-secondary group-hover:text-accent-purple transition-colors" />
    </div>
  </button>
);
