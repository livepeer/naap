/**
 * Hook for fetching Dune-style network overview data
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface NetworkSnapshot {
  round: number;
  totalBonded: string;
  totalSupply: string;
  participationRate: number;
  inflation: string;
  activeOrchestrators: number;
  delegatorsCount: number;
  totalVolumeETH: string;
  totalVolumeUSD: string;
  avgRewardCut: number;
  avgFeeShare: number;
  lptPriceUsd: number;
  ethPriceUsd: number;
  snapshotAt: string;
}

export interface TopOrchestrator {
  address: string;
  name: string | null;
  totalStake: string;
  rewardCut: number;
  feeShare: number;
  totalVolumeETH: string;
  thirtyDayVolumeETH: string;
  delegatorCount: number;
  rewardCallRatio: number;
  isActive: boolean;
  categories?: string[];
}

export interface NetworkOverviewData {
  snapshots: NetworkSnapshot[];
  topOrchestrators: TopOrchestrator[];
  prices: { lptUsd: number; ethUsd: number; lptChange24h: number };
  current: {
    totalBonded: string;
    totalSupply: string;
    participationRate: number;
    activeOrchestrators: number;
    delegatorsCount: number;
    totalVolumeETH: string;
    totalVolumeUSD: string;
    inflation: string;
  } | null;
}

export function useNetworkOverview(days = 90) {
  const [data, setData] = useState<NetworkOverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(true);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/network/overview?days=${days}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
      setSynced(json.data?.synced !== false);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch network overview:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { data, isLoading, error, synced, refresh: fetch_ };
}
