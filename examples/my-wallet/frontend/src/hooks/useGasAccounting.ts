/**
 * Gas accounting hook (S7)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';
import { useWallet } from '../context/WalletContext';

interface GasSummary {
  totalGasUsed: string;
  totalGasCostWei: string;
  totalGasCostEth: number;
  transactionCount: number;
  avgGasPerTx: number;
  byType: Record<string, { count: number; totalGasWei: string }>;
}

export function useGasAccounting() {
  const { isConnected } = useWallet();
  const [summary, setSummary] = useState<GasSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/gas-summary`);
      if (res.ok) {
        const json = await res.json();
        setSummary(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch gas summary:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { summary, isLoading, refresh: fetch_ };
}
