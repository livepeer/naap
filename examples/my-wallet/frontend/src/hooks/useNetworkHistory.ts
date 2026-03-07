/**
 * Network history hook (S21)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

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
  const { isConnected } = useWallet();
  const [data, setData] = useState<NetworkTrends | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/network/history?limit=${limit}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch network history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, limit]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, isLoading, refresh: fetch_ };
}
