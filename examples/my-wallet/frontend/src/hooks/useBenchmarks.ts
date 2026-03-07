/**
 * useBenchmarks - Hook for network-level benchmark stats
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface BenchmarkData {
  avgRewardCut: number;
  avgFeeShare: number;
  medianRewardCut: number;
  activeOrchestratorCount: number;
  totalDelegatorStake: string;
}

export function useBenchmarks() {
  const shell = useShell();
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/network/benchmarks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setData(json.data ?? json);
    } catch (err) {
      console.error('Failed to fetch benchmarks:', err);
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return {
    participationRate: 0,
    avgRewardCut: data?.avgRewardCut ?? 0,
    avgFeeShare: data?.avgFeeShare ?? 0,
    medianRewardCut: data?.medianRewardCut ?? 0,
    activeOrchestratorCount: data?.activeOrchestratorCount ?? 0,
    totalDelegatorStake: data?.totalDelegatorStake ?? '0',
    isLoading,
    refresh,
  };
}
