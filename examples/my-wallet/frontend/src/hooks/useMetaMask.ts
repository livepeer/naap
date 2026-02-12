/**
 * useMetaMask - Core hook for MetaMask wallet connection
 */

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';
import { isMetaMaskInstalled, delay } from '../lib/utils';
import { SUPPORTED_CHAIN_IDS, getNetworkByChainId } from '../lib/contracts';

export interface MetaMaskState {
  address: string | null;
  chainId: number | null;
  balance: bigint | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
}

export interface UseMetaMaskReturn extends MetaMaskState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: (chainId: number) => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  isMetaMaskInstalled: boolean;
  isSupportedNetwork: boolean;
  networkName: string | null;
}

const initialState: MetaMaskState = {
  address: null,
  chainId: null,
  balance: null,
  isConnected: false,
  isConnecting: false,
  error: null,
  provider: null,
  signer: null,
};

export function useMetaMask(): UseMetaMaskReturn {
  const [state, setState] = useState<MetaMaskState>(initialState);
  const installed = isMetaMaskInstalled();

  // Update balance
  const updateBalance = useCallback(async (provider: BrowserProvider, address: string) => {
    try {
      const balance = await provider.getBalance(address);
      setState(prev => ({ ...prev, balance }));
    } catch (err) {
      console.error('Failed to get balance:', err);
    }
  }, []);

  // Handle account changes
  const handleAccountsChanged = useCallback((accounts: string[]) => {
    if (accounts.length === 0) {
      // Disconnected
      setState(initialState);
      localStorage.removeItem('wallet_connected');
    } else {
      setState(prev => ({ ...prev, address: accounts[0] }));
      if (state.provider && accounts[0]) {
        updateBalance(state.provider, accounts[0]);
      }
    }
  }, [state.provider, updateBalance]);

  // Handle chain changes
  const handleChainChanged = useCallback((chainIdHex: string) => {
    const chainId = parseInt(chainIdHex, 16);
    setState(prev => ({ ...prev, chainId }));
    // Reload balance on network change
    if (state.provider && state.address) {
      updateBalance(state.provider, state.address);
    }
  }, [state.provider, state.address, updateBalance]);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!installed) {
      setState(prev => ({ ...prev, error: 'MetaMask is not installed' }));
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const provider = new BrowserProvider(window.ethereum as any);
      const accounts = await provider.send('eth_requestAccounts', []);
      
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      const address = accounts[0];
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      const signer = await provider.getSigner();
      const balance = await provider.getBalance(address);

      setState({
        address,
        chainId,
        balance,
        isConnected: true,
        isConnecting: false,
        error: null,
        provider,
        signer,
      });

      localStorage.setItem('wallet_connected', 'true');
    } catch (err: any) {
      const message = err?.code === 4001 
        ? 'Connection rejected by user'
        : err?.message || 'Failed to connect wallet';
      
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: message,
      }));
    }
  }, [installed]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    setState(initialState);
    localStorage.removeItem('wallet_connected');
  }, []);

  // Switch network
  const switchNetwork = useCallback(async (targetChainId: number) => {
    if (!installed || !window.ethereum) {
      throw new Error('MetaMask is not installed');
    }

    const chainIdHex = `0x${targetChainId.toString(16)}`;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (err: any) {
      // Chain not added, try to add it
      if (err.code === 4902) {
        const network = getNetworkByChainId(targetChainId);
        if (!network) {
          throw new Error('Unsupported network');
        }

        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainIdHex,
            chainName: network.name,
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.blockExplorer],
          }],
        });
      } else {
        throw err;
      }
    }
  }, [installed]);

  // Sign message
  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!state.signer) {
      throw new Error('Wallet not connected');
    }
    return state.signer.signMessage(message);
  }, [state.signer]);

  // Setup event listeners
  useEffect(() => {
    if (!installed || !window.ethereum) return;

    window.ethereum!.on('accountsChanged', handleAccountsChanged);
    window.ethereum!.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum!.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum!.removeListener('chainChanged', handleChainChanged);
    };
  }, [installed, handleAccountsChanged, handleChainChanged]);

  // Auto-connect if previously connected
  useEffect(() => {
    const wasConnected = localStorage.getItem('wallet_connected') === 'true';
    if (wasConnected && installed && !state.isConnected && !state.isConnecting) {
      // Small delay to prevent flash
      delay(100).then(() => connect());
    }
  }, [installed, state.isConnected, state.isConnecting, connect]);

  const isSupportedNetwork = state.chainId !== null && SUPPORTED_CHAIN_IDS.includes(state.chainId);
  const network = state.chainId ? getNetworkByChainId(state.chainId) : null;

  return {
    ...state,
    connect,
    disconnect,
    switchNetwork,
    signMessage,
    isMetaMaskInstalled: installed,
    isSupportedNetwork,
    networkName: network?.name || null,
  };
}
