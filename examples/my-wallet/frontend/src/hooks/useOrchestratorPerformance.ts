/**
 * Hook for fetching orchestrator performance data (monthly snapshots)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

export interface MonthlySnapshotData {
  month: string;
  bondedAmount: string;
  lptRewardsAccrued: string;
  ethFeesAccrued: string;
  lptPriceUsd: number;
  ethPriceUsd: number;
}

export interface OrchestratorPerformanceData {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  rewardCallRatio: number;
  totalVolumeETH: string;
  categories?: string[];
  monthlySnapshots: MonthlySnapshotData[];
  performance: {
    totalLptRewards: string;
    totalEthFees: string;
    avgMonthlyRewardLpt: string;
    avgMonthlyFeeEth: string;
  };
}

export interface PerformanceSummary {
  totalLptRewards: string;
  totalEthFees: string;
  totalStaked: string;
  monthsTracked: number;
}

export function useOrchestratorPerformance(mode: 'all' | 'staked' = 'all', months = 12) {
  const { address } = useWallet();
  const [orchestrators, setOrchestrators] = useState<OrchestratorPerformanceData[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ mode, months: months.toString() });
      if (address) params.set('address', address);

      const res = await fetch(`${getApiUrl()}/orchestrators/performance?${params}`);
      if (res.ok) {
        const json = await res.json();
        setOrchestrators(json.orchestrators || []);
        setSummary(json.summary || null);
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator performance:', err);
    } finally {
      setIsLoading(false);
    }
  }, [mode, months, address]);

  const triggerSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/snapshots/monthly`, { method: 'POST' });
      if (res.ok) {
        await fetch_();
      }
    } catch (err) {
      console.error('Failed to trigger snapshot:', err);
    }
  }, [fetch_]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { orchestrators, summary, isLoading, refresh: fetch_, triggerSnapshot };
}
