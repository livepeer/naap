/**
 * Hook for fetching orchestrator capability categories
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiUrl } from '../App';

export interface CapabilityMap {
  [address: string]: {
    categories: string[];
    pipelines: string[];
    lastChecked: string;
  };
}

export function useCapabilities() {
  const [data, setData] = useState<CapabilityMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiUrl()}/orchestrators/capabilities`, { signal });
      if (res.ok) {
        const json = await res.json();
        setData(json.data || {});
      } else {
        setError(`Failed to load capabilities (${res.status})`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch capabilities:', err);
      setError('Failed to load capability data. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch_(controller.signal);
    return () => controller.abort();
  }, [fetch_]);

  return { capabilities: data, isLoading, error, refresh: fetch_ };
}
