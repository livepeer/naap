import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchRank, type LeaderboardRequest, type OrchestratorRow, type RankResponse } from '../lib/api';

interface UseLeaderboardOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseLeaderboardResult {
  data: OrchestratorRow[];
  loading: boolean;
  error: string | null;
  cacheStatus: 'HIT' | 'MISS' | null;
  cacheAge: number;
  dataFreshness: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

export function useLeaderboard(
  request: LeaderboardRequest | null,
  options: UseLeaderboardOptions = {}
): UseLeaderboardResult {
  const { autoRefresh = false, refreshInterval = 5000 } = options;

  const [data, setData] = useState<OrchestratorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<'HIT' | 'MISS' | null>(null);
  const [cacheAge, setCacheAge] = useState(0);
  const [dataFreshness, setDataFreshness] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const requestRef = useRef(request);
  requestRef.current = request;

  const doFetch = useCallback(async () => {
    const req = requestRef.current;
    if (!req?.capability) return;

    setLoading(true);
    try {
      const result: RankResponse = await fetchRank(req);
      setData(result.data);
      setCacheStatus(result.cacheStatus);
      setCacheAge(result.cacheAge);
      setDataFreshness(result.dataFreshness);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!request?.capability) return;
    doFetch();
  }, [
    request?.capability,
    request?.topN,
    JSON.stringify(request?.filters),
    JSON.stringify(request?.slaWeights),
    doFetch,
  ]);

  useEffect(() => {
    if (!autoRefresh || !request?.capability) return;
    const interval = setInterval(doFetch, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, doFetch, request?.capability]);

  return { data, loading, error, cacheStatus, cacheAge, dataFreshness, lastUpdated, refresh: doFetch };
}
