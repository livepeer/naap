/**
 * useLPTBalance Hook
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContractRunner } from 'ethers';
import { createLPTToken } from '../contracts/LPTToken.js';
import { formatEther } from 'ethers';

export function useLPTBalance(
  provider: ContractRunner | null,
  chainId: number | null,
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
    if (!provider || !chainId || !address) {
      setBalance(null);
      setBalanceWei(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const lpt = createLPTToken(chainId, provider);
      const wei = await lpt.balanceOf(address);
      if (!mountedRef.current) return;
      setBalanceWei(wei);
      setBalance(formatEther(wei));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch LPT balance'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [provider, chainId, address]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => { mountedRef.current = false; };
  }, [fetch]);

  return { balance, balanceWei, loading, error, refetch: fetch };
}
