/**
 * useBalance Hook
 *
 * Fetches ETH balance for an address.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BrowserProvider } from 'ethers';
import { formatEther } from '../utils.js';

/**
 * Hook to fetch the ETH balance of an address.
 */
export function useBalance(
  provider: BrowserProvider | null,
  address: string | null
): {
  balance: string | null;
  balanceWei: bigint | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    if (!provider || !address) {
      setBalance(null);
      setBalanceWei(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const wei = await provider.getBalance(address);
      if (!mountedRef.current) return;
      setBalanceWei(wei);
      setBalance(formatEther(wei));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch balance'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [provider, address]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => { mountedRef.current = false; };
  }, [fetch]);

  return { balance, balanceWei, loading, error, refetch: fetch };
}
