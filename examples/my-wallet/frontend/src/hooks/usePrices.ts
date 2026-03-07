/**
 * usePrices - Hook for LPT/ETH USD prices (polls every 5min)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface PriceData {
  lptUsd: number;
  ethUsd: number;
  lptChange24h: number;
  lptChange7d: number;
  ethChange24h: number;
  lptMarketCap: number;
  lptVolume24h: number;
  fetchedAt: string;
}

export interface PriceChartPoint {
  timestamp: number;
  price: number;
}

const DEFAULT_PRICES: PriceData = {
  lptUsd: 0, ethUsd: 0, lptChange24h: 0, lptChange7d: 0,
  ethChange24h: 0, lptMarketCap: 0, lptVolume24h: 0, fetchedAt: '',
};

export function usePrices() {
  const shell = useShell();
  const [prices, setPrices] = useState<PriceData>(DEFAULT_PRICES);
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
        lptChange24h: data.lptChange24h ?? 0,
        lptChange7d: data.lptChange7d ?? 0,
        ethChange24h: data.ethChange24h ?? 0,
        lptMarketCap: data.lptMarketCap ?? 0,
        lptVolume24h: data.lptVolume24h ?? 0,
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

export function usePriceChart(days: number = 30) {
  const shell = useShell();
  const [points, setPoints] = useState<PriceChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/prices/chart?days=${days}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setPoints(json.data?.points ?? []);
    } catch (err) {
      console.error('Failed to fetch price chart:', err);
    } finally {
      setIsLoading(false);
    }
  }, [shell, days]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { points, isLoading, refresh };
}
