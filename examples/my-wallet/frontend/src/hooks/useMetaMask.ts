/**
 * useMetaMask - Core hook for MetaMask wallet connection
 *
 * Handles account switching, multiple accounts, and chain changes.
 * Exposes `accounts` (all permitted) and `address` (active selection).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';
import { isMetaMaskInstalled, delay } from '../lib/utils';
import { SUPPORTED_CHAIN_IDS, getNetworkByChainId } from '../lib/contracts';

export interface MetaMaskState {
  address: string | null;
  accounts: string[];          // all permitted accounts
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
  switchAccount: (address: string) => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  isMetaMaskInstalled: boolean;
  isSupportedNetwork: boolean;
  networkName: string | null;
}

const initialState: MetaMaskState = {
  address: null,
  accounts: [],
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
  const providerRef = useRef<BrowserProvider | null>(null);

  // Re-create provider + signer for a given address
  const setupProviderForAddress = useCallback(async (address: string, allAccounts: string[]) => {
    try {
      const provider = new BrowserProvider(window.ethereum as any);
      providerRef.current = provider;
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      const signer = await provider.getSigner(address);
      let balance: bigint | null = null;
      try {
        balance = await provider.getBalance(address);
      } catch {}

      setState({
        address,
        accounts: allAccounts,
        chainId,
        balance,
        isConnected: true,
        isConnecting: false,
        error: null,
        provider,
        signer,
      });

      localStorage.setItem('wallet_connected', 'true');
      localStorage.setItem('wallet_active_address', address);
    } catch (err: any) {
      console.error('Failed to setup provider:', err);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: err?.message || 'Failed to setup wallet',
      }));
    }
  }, []);

  // Handle account changes from MetaMask
  const handleAccountsChanged = useCallback((accounts: string[]) => {
    if (accounts.length === 0) {
      setState(initialState);
      providerRef.current = null;
      localStorage.removeItem('wallet_connected');
      localStorage.removeItem('wallet_active_address');
    } else {
      // Re-setup provider with the new active account (first in list)
      // but keep all accounts
      setupProviderForAddress(accounts[0], accounts);
    }
  }, [setupProviderForAddress]);

  // Handle chain changes
  const handleChainChanged = useCallback((_chainIdHex: string) => {
    // Full re-setup needed: provider, signer, balance all change on chain switch
    if (state.address && state.accounts.length > 0) {
      setupProviderForAddress(state.address, state.accounts);
    }
  }, [state.address, state.accounts, setupProviderForAddress]);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!installed) {
      setState(prev => ({ ...prev, error: 'MetaMask is not installed' }));
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const provider = new BrowserProvider(window.ethereum as any);
      const accounts: string[] = await provider.send('eth_requestAccounts', []);

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Use previously active address if it's still in the list, otherwise first
      const savedAddr = localStorage.getItem('wallet_active_address')?.toLowerCase();
      const activeAddr = (savedAddr && accounts.find(a => a.toLowerCase() === savedAddr))
        ? accounts.find(a => a.toLowerCase() === savedAddr)!
        : accounts[0];

      await setupProviderForAddress(activeAddr, accounts);
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
  }, [installed, setupProviderForAddress]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    setState(initialState);
    providerRef.current = null;
    localStorage.removeItem('wallet_connected');
    localStorage.removeItem('wallet_active_address');
  }, []);

  // Switch to a different permitted account (user picks from dropdown)
  const switchAccount = useCallback(async (targetAddress: string) => {
    if (!state.accounts.includes(targetAddress)) {
      throw new Error('Account not permitted');
    }
    await setupProviderForAddress(targetAddress, state.accounts);
  }, [state.accounts, setupProviderForAddress]);

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
      if (err.code === 4902) {
        const network = getNetworkByChainId(targetChainId);
        if (!network) throw new Error('Unsupported network');

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
    if (!state.signer) throw new Error('Wallet not connected');
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
    switchAccount,
    signMessage,
    isMetaMaskInstalled: installed,
    isSupportedNetwork,
    networkName: network?.name || null,
  };
}
