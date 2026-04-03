/**
 * Reward consistency hook (S9)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

interface RewardConsistency {
  orchestratorAddr: string;
  totalRounds: number;
  rewardsCalled: number;
  rewardsMissed: number;
  callRate: number;
  currentMissStreak: number;
  longestMissStreak: number;
  recentHistory: { round: number; called: boolean }[];
}

export function useRewardConsistency(orchestratorAddr?: string) {
  const [data, setData] = useState<RewardConsistency | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    if (!orchestratorAddr) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiUrl()}/orchestrators/consistency?address=${encodeURIComponent(orchestratorAddr)}`,
        { signal },
      );
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      } else {
        setError(`Failed to load reward consistency (${res.status})`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch reward consistency:', err);
      setError('Failed to load reward consistency data. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [orchestratorAddr]);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { data, isLoading, error, refresh: fetch_ };
}
