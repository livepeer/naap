/**
 * useWalletConnect Hook
 *
 * Manages wallet connection lifecycle via MetaMask or other EIP-1193 providers.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserProvider, type Eip1193Provider } from 'ethers';

export interface WalletState {
  /** Connected wallet address */
  address: string | null;
  /** Current chain ID */
  chainId: number | null;
  /** Whether connected */
  connected: boolean;
  /** Whether connection is in progress */
  connecting: boolean;
  /** Connection error */
  error: Error | null;
  /** The ethers BrowserProvider */
  provider: BrowserProvider | null;
}

/**
 * Hook for connecting to a browser wallet (MetaMask, etc.).
 */
export function useWalletConnect(): WalletState & {
  connect: () => Promise<void>;
  disconnect: () => void;
} {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const mountedRef = useRef(true);

  // Get ethereum object
  const getEthereum = useCallback((): Eip1193Provider | null => {
    if (typeof window === 'undefined') return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).ethereum as Eip1193Provider | null;
  }, []);

  // Connect to wallet
  const connect = useCallback(async () => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError(new Error('No wallet extension detected. Install MetaMask or another EIP-1193 wallet.'));
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const browserProvider = new BrowserProvider(ethereum);
      const accounts = await browserProvider.send('eth_requestAccounts', []);
      const network = await browserProvider.getNetwork();

      if (!mountedRef.current) return;

      setProvider(browserProvider);
      setAddress(accounts[0] || null);
      setChainId(Number(network.chainId));
      setConnected(true);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Wallet connection failed'));
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }, [getEthereum]);

  // Disconnect
  const disconnect = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setConnected(false);
    setProvider(null);
    setError(null);
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    mountedRef.current = true;
    const ethereum = getEthereum();
    if (!ethereum || !('on' in ethereum)) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = ethereum as any;

    const handleAccountsChanged = (accounts: string[]) => {
      if (!mountedRef.current) return;
      if (accounts.length === 0) {
        disconnect();
      } else {
        setAddress(accounts[0]);
      }
    };

    const handleChainChanged = (chainIdHex: string) => {
      if (!mountedRef.current) return;
      setChainId(parseInt(chainIdHex, 16));
      // Re-create provider on chain change
      if (ethereum) {
        setProvider(new BrowserProvider(ethereum));
      }
    };

    eth.on('accountsChanged', handleAccountsChanged);
    eth.on('chainChanged', handleChainChanged);

    return () => {
      mountedRef.current = false;
      eth.removeListener?.('accountsChanged', handleAccountsChanged);
      eth.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [getEthereum, disconnect]);

  return {
    address, chainId, connected, connecting, error, provider,
    connect, disconnect,
  };
}
