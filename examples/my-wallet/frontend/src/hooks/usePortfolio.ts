/**
 * usePortfolio - Hook for aggregated portfolio data
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

interface PortfolioData {
  totalStaked: string;
  totalPendingRewards: string;
  totalPendingFees: string;
  addressCount: number;
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

  const refresh = useCallback(async () => {
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
      });
      const json = await res.json();
      const data = json.data ?? json;
      setPortfolio(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch portfolio');
    } finally {
      setIsLoading(false);
    }
  }, [shell, address]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return { portfolio, isLoading, error, refresh };
}
