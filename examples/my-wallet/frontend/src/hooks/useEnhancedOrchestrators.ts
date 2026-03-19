/**
 * Hook for fetching enhanced orchestrator data with capabilities and date-range filtering
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface EnhancedOrchestrator {
  id: string;
  address: string;
  name: string | null;
  serviceUri: string | null;
  totalStake: string;
  rewardCut: number;
  feeShare: number;
  isActive: boolean;
  activationRound: number | null;
  totalVolumeETH: string;
  thirtyDayVolumeETH: string;
  ninetyDayVolumeETH: string;
  totalRewardTokens: string;
  lastRewardRound: number;
  delegatorCount: number;
  rewardCallRatio: number;
  categories: string[];
  pipelines: string[];
  rangePerformance: { rounds: number; rewardCalls: number } | null;
}

export function useEnhancedOrchestrators(from?: number, to?: number) {
  const [orchestrators, setOrchestrators] = useState<EnhancedOrchestrator[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ activeOnly: 'true' });
      if (from) params.set('from', from.toString());
      if (to) params.set('to', to.toString());

      const res = await fetch(`${getApiUrl()}/orchestrators/enhanced?${params}`);
      if (res.ok) {
        const json = await res.json();
        setOrchestrators(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch enhanced orchestrators:', err);
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { orchestrators, isLoading, refresh: fetch_ };
}
