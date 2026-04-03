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
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ activeOnly: 'true' });
      if (from) params.set('from', from.toString());
      if (to) params.set('to', to.toString());

      const res = await fetch(`${getApiUrl()}/orchestrators/enhanced?${params}`, { signal });
      if (res.ok) {
        const json = await res.json();
        setOrchestrators(json.data || []);
      } else {
        setError(`Failed to load orchestrator data (${res.status})`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch enhanced orchestrators:', err);
      setError('Failed to load orchestrators. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { orchestrators, isLoading, error, refresh: fetch_ };
}
