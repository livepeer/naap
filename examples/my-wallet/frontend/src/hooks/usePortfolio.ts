/**
 * usePortfolio - Hook for aggregated portfolio data
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

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
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/portfolio`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      const data = json.data ?? json;
      setPortfolio(data.portfolio || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch portfolio');
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return { portfolio, isLoading, error, refresh };
}
