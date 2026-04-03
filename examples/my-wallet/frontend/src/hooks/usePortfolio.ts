/**
 * usePortfolio - Hook for aggregated portfolio data
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

export interface PortfolioPosition {
  address: string;
  orchestrator: string;
  stakedAmount: string;
  pendingRewards?: string;
  pendingFees?: string;
  startRound?: string;
  lastClaimRound?: string;
  orchestratorInfo?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

interface PortfolioData {
  totalStaked: string;
  totalPendingRewards: string;
  totalPendingFees: string;
  addressCount: number;
  positions?: PortfolioPosition[];
}

interface UsePortfolioReturn {
  portfolio: PortfolioData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePortfolio(): UsePortfolioReturn {
  const shell = useShell();
  const { address } = useWallet();
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/portfolio?address=${address}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
      });
      const json = await res.json();
      const data = json.data ?? json;
      setPortfolio(data);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err?.message || 'Failed to fetch portfolio');
    } finally {
      setIsLoading(false);
    }
  }, [shell, address]);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [address, refresh]);

  return { portfolio, isLoading, error, refresh };
}
