/**
 * WalletContext - Global wallet state management
 */

import React, { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import { useMetaMask, MetaMaskState } from '../hooks/useMetaMask';
import { TransactionRequest, TransactionResponse } from 'ethers';

export interface WalletContextValue extends MetaMaskState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: (chainId: number) => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  sendTransaction: (tx: TransactionRequest) => Promise<TransactionResponse>;
  isMetaMaskInstalled: boolean;
  isSupportedNetwork: boolean;
  networkName: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

interface WalletProviderProps {
  children: React.ReactNode;
  onConnect?: (address: string, chainId: number) => void;
  onDisconnect?: () => void;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({
  children,
  onConnect,
  onDisconnect,
}) => {
  const metamask = useMetaMask();

  // Send transaction
  const sendTransaction = useCallback(async (tx: TransactionRequest): Promise<TransactionResponse> => {
    if (!metamask.signer) {
      throw new Error('Wallet not connected');
    }
    return metamask.signer.sendTransaction(tx);
  }, [metamask.signer]);

  // Notify on connect/disconnect
  useEffect(() => {
    if (metamask.isConnected && metamask.address && metamask.chainId) {
      onConnect?.(metamask.address, metamask.chainId);
    }
  }, [metamask.isConnected, metamask.address, metamask.chainId, onConnect]);

  useEffect(() => {
    if (!metamask.isConnected && onDisconnect) {
      onDisconnect();
    }
  }, [metamask.isConnected, onDisconnect]);

  const value = useMemo<WalletContextValue>(() => ({
    ...metamask,
    sendTransaction,
  }), [metamask, sendTransaction]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

export default WalletContext;
