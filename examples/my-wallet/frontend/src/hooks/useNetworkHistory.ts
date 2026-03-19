/**
 * Network history hook — fetches from backend (RPC fallback when subgraph unavailable)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

interface NetworkHistoryPoint {
  round: number;
  totalBonded: string;
  participationRate: number;
  inflation: string;
  activeOrchestrators: number;
  avgRewardCut: number;
  avgFeeShare: number;
  snapshotAt: string;
}

interface NetworkTrends {
  dataPoints: NetworkHistoryPoint[];
  summary: {
    bondedChange: string;
    participationChange: number;
    orchestratorCountChange: number;
    periodStart: string;
    periodEnd: string;
  };
}

export function useNetworkHistory(limit = 90) {
  const [data, setData] = useState<NetworkTrends | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/network/history?limit=${limit}`, { signal });
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch network history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { data, isLoading, refresh: fetch_ };
}
