/**
 * useProtocolParams - Hook for cached Livepeer protocol parameters
 */

import { useState, useEffect, useCallback } from 'react';
import { useShell } from '@naap/plugin-sdk';
import { getApiUrl } from '../App';

interface ProtocolParams {
  currentRound: number;
  roundLength: number;
  unbondingPeriod: number;
  totalBonded: string;
  participationRate: number;
  inflation: string;
  lastUpdated: string;
}

interface UseProtocolParamsReturn {
  params: ProtocolParams | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProtocolParams(): UseProtocolParamsReturn {
  const shell = useShell();
  const [params, setParams] = useState<ProtocolParams | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const apiUrl = getApiUrl();
      const token = await shell.auth.getToken().catch(() => '');
      const res = await fetch(`${apiUrl}/protocol/params`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      const data = json.data ?? json;
      setParams(data.params || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch protocol params');
    } finally {
      setIsLoading(false);
    }
  }, [shell]);

  useEffect(() => {
    const user = shell.auth.getUser();
    if (user) refresh();
  }, [shell, refresh]);

  return { params, isLoading, error, refresh };
}
