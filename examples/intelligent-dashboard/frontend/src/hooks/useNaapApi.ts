/**
 * NAAP API Hook
 *
 * Calls the Livepeer NAAP API via the server-side proxy (no gateway connector).
 * Endpoints:
 *   GET /api/v1/naap-api/pipelines
 *   GET /api/v1/naap-api/aggregated_stats?pipeline=...&model=...
 *   GET /api/v1/naap-api/raw_stats?pipeline=...&model=...&orchestrator=...
 * Auth: JWT (injected by useApiClient)
 */

import { useCallback, useMemo } from 'react';
import { useApiClient, useTeam } from '@naap/plugin-sdk';
import type {
  PipelinesApiResponse,
  PipelineEntry,
  AggregatedStatsApiResponse,
  OrchestratorStats,
  RawStatsResponse,
} from '../types';

const NAAP_API_BASE = '/api/v1/naap-api';

function unwrap<T>(sdkResponse: unknown): T {
  const apiRes = sdkResponse as { data: unknown };
  const body = apiRes.data as Record<string, unknown>;
  return body as T;
}

export function useNaapApi() {
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

  const fetchPipelines = useCallback(async (): Promise<PipelineEntry[]> => {
    const res = await apiClient.get(`${NAAP_API_BASE}/pipelines`, headers());
    const raw = unwrap<PipelinesApiResponse>(res);
    return raw?.pipelines ?? [];
  }, [apiClient, headers]);

  /**
   * Fetches aggregated stats and normalizes the dict-keyed upstream
   * response into a flat OrchestratorStats array.
   */
  const fetchStats = useCallback(
    async (pipeline: string, model: string): Promise<OrchestratorStats[]> => {
      const params = new URLSearchParams({ pipeline, model });
      const res = await apiClient.get(
        `${NAAP_API_BASE}/aggregated_stats?${params.toString()}`,
        headers(),
      );
      const raw = unwrap<AggregatedStatsApiResponse>(res);

      if (!raw || typeof raw !== 'object') return [];

      const result: OrchestratorStats[] = [];
      for (const [addr, regions] of Object.entries(raw)) {
        if (!regions || typeof regions !== 'object') continue;
        for (const [region, stats] of Object.entries(regions)) {
          result.push({
            orchestrator: addr,
            score: stats.score ?? 0,
            latency_score: stats.round_trip_score ?? 0,
            success_rate: stats.success_rate ?? 0,
            total_rounds: 0,
            region,
          });
        }
      }
      return result;
    },
    [apiClient, headers],
  );

  const fetchRawStats = useCallback(
    async (pipeline: string, model: string, orchestrator: string): Promise<RawStatsResponse> => {
      const params = new URLSearchParams({ pipeline, model, orchestrator });
      const res = await apiClient.get(
        `${NAAP_API_BASE}/raw_stats?${params.toString()}`,
        headers(),
      );
      return unwrap<RawStatsResponse>(res);
    },
    [apiClient, headers],
  );

  return useMemo(
    () => ({ fetchPipelines, fetchStats, fetchRawStats }),
    [fetchPipelines, fetchStats, fetchRawStats],
  );
}
