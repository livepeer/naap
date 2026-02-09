/**
 * useSwitchNetwork Hook
 *
 * Switch the wallet to a different network/chain.
 */

import { useState, useCallback } from 'react';
import { SUPPORTED_CHAINS } from '../provider.js';

/**
 * Hook for switching the connected wallet to a different chain.
 */
export function useSwitchNetwork(): {
  switchNetwork: (chainId: number) => Promise<void>;
  switching: boolean;
  error: Error | null;
} {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const switchNetwork = useCallback(async (chainId: number) => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setError(new Error('No wallet extension detected'));
      return;
    }

    setSwitching(true);
    setError(null);

    const hexChainId = `0x${chainId.toString(16)}`;

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (switchError: unknown) {
      // If chain not added, try adding it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((switchError as any)?.code === 4902) {
        const chain = SUPPORTED_CHAINS[chainId];
        if (chain) {
          try {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: hexChainId,
                chainName: chain.name,
                rpcUrls: [chain.rpcUrl],
                blockExplorerUrls: [chain.blockExplorer],
                nativeCurrency: chain.nativeCurrency,
              }],
            });
          } catch (addError) {
            setError(addError instanceof Error ? addError : new Error('Failed to add network'));
          }
        } else {
          setError(new Error(`Unknown chain ID: ${chainId}`));
        }
      } else {
        setError(switchError instanceof Error ? switchError : new Error('Failed to switch network'));
      }
    } finally {
      setSwitching(false);
    }
  }, []);

  return { switchNetwork, switching, error };
}
