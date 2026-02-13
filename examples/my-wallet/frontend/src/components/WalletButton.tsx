/**
 * WalletButton - Compact wallet connection button
 * Can be used in TopBar or other locations
 */

import React from 'react';
import { Wallet, ChevronDown, Power, ExternalLink } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { formatAddress, getExplorerAddressUrl } from '../lib/utils';

interface WalletButtonProps {
  onNavigate?: (path: string) => void;
  compact?: boolean;
}

export const WalletButton: React.FC<WalletButtonProps> = ({ onNavigate, compact = false }) => {
  const {
    address,
    chainId,
    isConnected,
    isConnecting,
    networkName,
    connect,
    disconnect,
    isMetaMaskInstalled,
  } = useWallet();

  const [showDropdown, setShowDropdown] = React.useState(false);

  if (!isConnected) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting || !isMetaMaskInstalled}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
          compact
            ? 'bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30'
            : 'wallet-gradient text-white hover:opacity-90'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isConnecting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {!compact && 'Connecting...'}
          </>
        ) : (
          <>
            <Wallet className="w-4 h-4" />
            {!compact && 'Connect Wallet'}
          </>
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary hover:bg-bg-secondary rounded-lg transition-colors"
      >
        <div className="w-6 h-6 rounded-full wallet-gradient flex items-center justify-center">
          <Wallet className="w-3 h-3 text-white" />
        </div>
        {!compact && (
          <>
            <div className="text-left">
              <p className="text-xs font-mono text-text-primary">{formatAddress(address!, 4)}</p>
              <p className="text-[10px] text-text-secondary">{networkName}</p>
            </div>
            <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {showDropdown && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)} 
          />
          
          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-56 bg-bg-secondary border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
            {/* Account Info */}
            <div className="p-3 border-b border-white/10">
              <p className="text-xs text-text-secondary">Connected Account</p>
              <p className="font-mono text-sm text-text-primary">{formatAddress(address!, 8)}</p>
            </div>

            {/* Actions */}
            <div className="p-2">
              {onNavigate && (
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    onNavigate('/wallet/dashboard');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
                >
                  <Wallet className="w-4 h-4" />
                  View Dashboard
                </button>
              )}

              {chainId && (
                <a
                  href={getExplorerAddressUrl(chainId, address!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
                  onClick={() => setShowDropdown(false)}
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </a>
              )}

              <button
                onClick={() => {
                  setShowDropdown(false);
                  disconnect();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-rose hover:bg-accent-rose/10 rounded-lg transition-colors"
              >
                <Power className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WalletButton;
