/**
 * usePrices - Hook for LPT/ETH USD prices (polls every 5min)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface PriceData {
  lptUsd: number;
  ethUsd: number;
  fetchedAt: string;
}

export function usePrices() {
  const shell = useShell();
  const [prices, setPrices] = useState<PriceData>({ lptUsd: 0, ethUsd: 0, fetchedAt: '' });
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/prices`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      const data = json.data ?? json;
      setPrices({
        lptUsd: data.lptUsd ?? 0,
        ethUsd: data.ethUsd ?? 0,
        fetchedAt: data.fetchedAt ?? '',
      });
    } catch (err) {
      console.error('Failed to fetch prices:', err);
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) {
      refresh();
      intervalRef.current = setInterval(refresh, 5 * 60 * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [shell, refresh]);

  return { ...prices, isLoading, refresh };
}
