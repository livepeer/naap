/**
 * Connect Page - Wallet connection UI
 */

import React from 'react';
import { Wallet, AlertCircle, ExternalLink } from 'lucide-react';
import { useWallet } from '../context/WalletContext';

export const ConnectPage: React.FC = () => {
  const {
    isConnecting,
    error,
    connect,
    isMetaMaskInstalled,
  } = useWallet();

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
