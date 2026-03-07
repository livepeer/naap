/**
 * useYield - Hook for yield calculation data
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

export type YieldPeriod = '7d' | '30d' | '90d' | 'ytd';

interface YieldChartPoint {
  date: string;
  round: number;
  cumulativeRewardYield: number;
  cumulativeFeeYield: number;
  cumulativeCombined: number;
}

interface YieldData {
  rewardYield: number;
  feeYield: number;
  combinedApy: number;
  periodDays: number;
  dataPoints: number;
  chart: YieldChartPoint[];
}

export function useYield() {
  const shell = useShell();
  const { address } = useWallet();
  const [data, setData] = useState<YieldData | null>(null);
  const [period, setPeriod] = useState<YieldPeriod>('30d');
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/yield?period=${period}&address=${address || ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setData(json.data ?? json);
    } catch (err) {
      console.error('Failed to fetch yield:', err);
    } finally {
      setIsLoading(false);
    }
  }, [shell, period]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return {
    rewardYield: data?.rewardYield ?? 0,
    feeYield: data?.feeYield ?? 0,
    combinedApy: data?.combinedApy ?? 0,
    chart: data?.chart ?? [],
    dataPoints: data?.dataPoints ?? 0,
    period,
    setPeriod,
    isLoading,
    refresh,
  };
}
