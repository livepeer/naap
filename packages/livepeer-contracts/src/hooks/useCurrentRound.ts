/**
 * useCurrentRound Hook
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContractRunner } from 'ethers';
import { createRoundsManager } from '../contracts/RoundsManager.js';

export interface RoundInfo {
  currentRound: number;
  initialized: boolean;
  startBlock: number;
  roundLength: number;
  lastInitializedRound: number;
  locked: boolean;
}

export function useCurrentRound(
  provider: ContractRunner | null,
  chainId: number | null
): {
  round: RoundInfo | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    if (!provider || !chainId) {
      setRound(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rm = createRoundsManager(chainId, provider);
      const [currentRound, initialized, startBlock, roundLength, lastInitializedRound, locked] =
        await Promise.all([
          rm.currentRound(),
          rm.currentRoundInitialized(),
          rm.currentRoundStartBlock(),
          rm.roundLength(),
          rm.lastInitializedRound(),
          rm.currentRoundLocked(),
        ]);

      if (!mountedRef.current) return;

      setRound({
        currentRound: Number(currentRound),
        initialized,
        startBlock: Number(startBlock),
        roundLength: Number(roundLength),
        lastInitializedRound: Number(lastInitializedRound),
        locked,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error('Failed to fetch round info'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [provider, chainId]);

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    return () => { mountedRef.current = false; };
  }, [fetch]);

  return { round, loading, error, refetch: fetch };
}
