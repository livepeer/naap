/**
 * Service Gateway — API Hooks
 *
 * Wraps useApiClient from plugin-sdk for gateway admin API calls.
 * All calls are team-scoped via x-team-id header.
 */

import { useCallback, useMemo, useState } from 'react';
import { useApiClient } from '@naap/plugin-sdk';
import { useTeam } from '@naap/plugin-sdk';

const GW_API_BASE = '/api/v1/gw/admin';

export function useGatewayApi() {
  const apiClient = useApiClient({ baseUrl: '' });
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const extraHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (teamId) h['x-team-id'] = teamId;
    return h;
  }, [teamId]);

  const get = useCallback(
    async <T = unknown>(path: string): Promise<T> => {
      const res = await apiClient.get(`${GW_API_BASE}${path}`, extraHeaders);
      return res.data as T;
    },
    [apiClient, extraHeaders]
  );

  const post = useCallback(
    async <T = unknown>(path: string, body?: unknown): Promise<T> => {
      const res = await apiClient.post(`${GW_API_BASE}${path}`, body, extraHeaders);
      return res.data as T;
    },
    [apiClient, extraHeaders]
  );

  const put = useCallback(
    async <T = unknown>(path: string, body?: unknown): Promise<T> => {
      const res = await apiClient.put(`${GW_API_BASE}${path}`, body, extraHeaders);
      return res.data as T;
    },
    [apiClient, extraHeaders]
  );

  const del = useCallback(
    async <T = unknown>(path: string): Promise<T> => {
      const res = await apiClient.delete(`${GW_API_BASE}${path}`, extraHeaders);
      return res.data as T;
    },
    [apiClient, extraHeaders]
  );

  return useMemo(() => ({ get, post, put, del, teamId }), [get, post, put, del, teamId]);
}

/**
 * Hook for async operations with loading and error states.
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

  return { data, loading, error, execute, setData };
}
