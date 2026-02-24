/**
 * Service Gateway — API Hooks
 *
 * Wraps useApiClient from plugin-sdk for gateway admin API calls.
 *
 * The gateway API routes live in the Next.js shell (same origin), NOT
 * in a separate backend service. We use `window.location.origin` as the
 * base URL so requests target the shell (port 3000) rather than the
 * default base-svc (port 4000).
 *
 * Calls are team-scoped (via x-team-id header) when a team is selected,
 * and user-scoped (personal context) when no team is active.
 */

import { useCallback, useMemo, useState } from 'react';
import { useApiClient, useTeam } from '@naap/plugin-sdk';

const GW_API_BASE = '/api/v1/gw/admin';

export function useGatewayApi() {
  // Use the shell's origin — gateway routes are Next.js API routes, not
  // a standalone backend, so we must NOT fall through to getServiceOrigin('base')
  // which resolves to http://localhost:4000 in dev.
  const shellOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    []
  );
  const apiClient = useApiClient({ baseUrl: shellOrigin });
  const teamContext = useTeam();
  const teamId = teamContext?.currentTeam?.id;

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (teamId) h['x-team-id'] = teamId;
    return h;
  }, [teamId]);

  // The SDK's apiClient.get() returns ApiResponse<T> = { data, status, headers }.
  // We unwrap the envelope so callers get the JSON body directly.

  const get = useCallback(
    async <T = unknown>(path: string): Promise<T> => {
      const res = await apiClient.get(`${GW_API_BASE}${path}`, headers());
      return (res as { data: T }).data;
    },
    [apiClient, headers]
  );

  const post = useCallback(
    async <T = unknown>(path: string, body?: unknown): Promise<T> => {
      const res = await apiClient.post(`${GW_API_BASE}${path}`, body, headers());
      return (res as { data: T }).data;
    },
    [apiClient, headers]
  );

  const put = useCallback(
    async <T = unknown>(path: string, body?: unknown): Promise<T> => {
      const res = await apiClient.put(`${GW_API_BASE}${path}`, body, headers());
      return (res as { data: T }).data;
    },
    [apiClient, headers]
  );

  const del = useCallback(
    async <T = unknown>(path: string): Promise<T> => {
      const res = await apiClient.delete(`${GW_API_BASE}${path}`, headers());
      return (res as { data: T }).data;
    },
    [apiClient, headers]
  );

  return useMemo(
    () => ({ get, post, put, del, teamId }),
    [get, post, put, del, teamId]
  );
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
