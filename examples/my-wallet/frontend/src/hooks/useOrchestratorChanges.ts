/**
 * Hook for detecting orchestrator parameter changes (watchlist alerts)
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface OrchestratorChange {
  address: string;
  field: string;
  oldValue: number | string;
  newValue: number | string;
  round: number;
  createdAt: string;
}

export function useOrchestratorChanges(addresses: string[], sinceRound?: number) {
  const [changes, setChanges] = useState<OrchestratorChange[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!addresses.length) {
      setChanges([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        addresses: addresses.join(','),
      });
      if (sinceRound) params.set('sinceRound', sinceRound.toString());

      const res = await fetch(`${getApiUrl()}/orchestrators/changes?${params}`);
      if (res.ok) {
        const json = await res.json();
        setChanges(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch orchestrator changes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [addresses.join(','), sinceRound]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { changes, isLoading, refresh: fetch_ };
}
