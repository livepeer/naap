/**
 * Leaderboard API Hook
 *
 * Consumes the Livepeer Leaderboard API through the Service Gateway proxy.
 * All requests go via /api/v1/gw/livepeer-leaderboard/* and are automatically
 * authenticated with the current user's JWT (injected by useApiClient).
 */

import { useCallback, useMemo, useState } from 'react';
import { useApiClient, useTeam } from '@naap/plugin-sdk';
import type {
  PipelinesResponse,
  AggregatedStatsResponse,
  RawStatsResponse,
} from '../types';

const GW_PROXY_BASE = '/api/v1/gw/livepeer-leaderboard';

/**
 * Gateway proxy responses are wrapped in an envelope:
 *   { success: boolean, data: T, meta: { ... } }
 *
 * The SDK's apiClient.get() returns { data: <full_json_body> },
 * so we need to unwrap both layers: sdk.data -> envelope.data -> T.
 */
interface GatewayEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

function unwrapGateway<T>(sdkResponse: unknown): T {
  const envelope = (sdkResponse as { data: GatewayEnvelope<T> }).data;
  return envelope.data;
}

export function useLeaderboardApi() {
  const shellOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );
  const apiClient = useApiClient({ baseUrl: shellOrigin });
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (teamId) h['x-team-id'] = teamId;
    return h;
  }, [teamId]);

  const fetchPipelines = useCallback(async (): Promise<PipelinesResponse> => {
    const res = await apiClient.get(`${GW_PROXY_BASE}/pipelines`, headers());
    return unwrapGateway<PipelinesResponse>(res);
  }, [apiClient, headers]);

  const fetchStats = useCallback(
    async (
      pipeline: string,
      model: string,
    ): Promise<AggregatedStatsResponse> => {
      const params = new URLSearchParams({ pipeline, model });
      const res = await apiClient.get(
        `${GW_PROXY_BASE}/stats?${params.toString()}`,
        headers(),
      );
      return unwrapGateway<AggregatedStatsResponse>(res);
    },
    [apiClient, headers],
  );

  const fetchRawStats = useCallback(
    async (
      pipeline: string,
      model: string,
      orchestrator: string,
    ): Promise<RawStatsResponse> => {
      const params = new URLSearchParams({ pipeline, model, orchestrator });
      const res = await apiClient.get(
        `${GW_PROXY_BASE}/stats/raw?${params.toString()}`,
        headers(),
      );
      return unwrapGateway<RawStatsResponse>(res);
    },
    [apiClient, headers],
  );

  return useMemo(
    () => ({ fetchPipelines, fetchStats, fetchRawStats, teamId }),
    [fetchPipelines, fetchStats, fetchRawStats, teamId],
  );
}

/**
 * Generic async state hook for loading / error / data management.
 */
export function useAsync<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  return { data, loading, error, execute, setData, reset };
}
