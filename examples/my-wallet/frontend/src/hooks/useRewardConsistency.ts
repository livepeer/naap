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

  const fetch_ = useCallback(async () => {
    if (!orchestratorAddr) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `${getApiUrl()}/orchestrators/consistency?address=${encodeURIComponent(orchestratorAddr)}`,
      );
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch reward consistency:', err);
    } finally {
      setIsLoading(false);
    }
  }, [orchestratorAddr]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, isLoading, refresh: fetch_ };
}
