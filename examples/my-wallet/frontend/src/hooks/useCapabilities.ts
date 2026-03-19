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

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/orchestrators/capabilities`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data || {});
      }
    } catch (err) {
      console.error('Failed to fetch capabilities:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { capabilities: data, isLoading, refresh: fetch_ };
}
