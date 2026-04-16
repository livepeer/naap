import { useState, useEffect, useCallback } from 'react';
import {
  fetchDatasetConfig,
  updateDatasetConfig,
  triggerDatasetRefresh,
  type DatasetConfig,
} from '../lib/api';

interface UseDatasetConfigResult {
  config: DatasetConfig | null;
  isLoading: boolean;
  error: string | null;
  updateInterval: (hours: number) => Promise<void>;
  refreshNow: () => Promise<void>;
  isRefreshing: boolean;
  lastRefreshResult: { capabilities: number; orchestrators: number } | null;
}

export function useDatasetConfig(): UseDatasetConfigResult {
  const [config, setConfig] = useState<DatasetConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshResult, setLastRefreshResult] = useState<{
    capabilities: number;
    orchestrators: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchDatasetConfig()
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load config');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateInterval = useCallback(async (hours: number) => {
    try {
      const updated = await updateDatasetConfig(hours);
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update interval');
      throw err;
    }
  }, []);

  const refreshNow = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await triggerDatasetRefresh();
      setLastRefreshResult({
        capabilities: result.capabilities,
        orchestrators: result.orchestrators,
      });
      const updated = await fetchDatasetConfig();
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      throw err;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return {
    config,
    isLoading,
    error,
    updateInterval,
    refreshNow,
    isRefreshing,
    lastRefreshResult,
  };
}
