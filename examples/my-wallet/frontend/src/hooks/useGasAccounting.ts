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

const emptySummary: GasSummary = {
  totalGasUsed: '0',
  totalGasCostWei: '0',
  totalGasCostEth: 0,
  transactionCount: 0,
  avgGasPerTx: 0,
  byType: {},
};

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
        const d = json.data || {};
        setSummary({
          totalGasUsed: d.totalGasUsed || '0',
          totalGasCostWei: d.totalGasCostWei || '0',
          totalGasCostEth: d.totalGasCostEth ?? (parseFloat(d.totalGasETH || '0') || 0),
          transactionCount: d.transactionCount || 0,
          avgGasPerTx: d.avgGasPerTx || 0,
          byType: d.byType || {},
        });
      } else {
        setSummary(emptySummary);
      }
    } catch (err) {
      console.error('Failed to fetch gas summary:', err);
      setSummary(emptySummary);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { summary, isLoading, refresh: fetch_ };
}
