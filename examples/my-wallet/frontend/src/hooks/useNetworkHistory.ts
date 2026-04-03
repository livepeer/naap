/**
 * Network history hook — fetches protocol status + historical snapshots
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface NetworkHistoryPoint {
  round: number;
  totalBonded: string;
  participationRate: number;
  inflation: string;
  activeOrchestrators: number;
  delegatorsCount?: number;
  volumeETH?: string;
  volumeUSD?: string;
  avgRewardCut: number;
  avgFeeShare: number;
  snapshotAt: string;
}

export interface RoundProgress {
  currentRound: number;
  roundLength: number;
  blocksElapsed: number;
  blocksRemaining: number;
  initialized: boolean;
  estimatedHoursRemaining: number;
}

export interface ProtocolStatus {
  currentRound: number;
  roundLength: number;
  participationRate: number;
  inflation: string;
  activeOrchestrators: number;
  delegatorsCount: number;
  totalSupply: string;
  totalSupplyRaw: number;
  totalBonded: string;
  totalBondedRaw: number;
  totalVolumeETH: string;
  totalVolumeUSD: string;
  roundProgress?: RoundProgress;
}

export interface NetworkTrends {
  protocolStatus?: ProtocolStatus;
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
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/network/history?limit=${limit}`, { signal });
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      } else {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(body.error || `HTTP ${res.status}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch network history:', err);
      setError(err.message || 'Network request failed');
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { data, isLoading, error, refresh: fetch_ };
}
