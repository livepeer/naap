/**
 * useDashboardQuery Hook
 *
 * Sends a GraphQL query string to the dashboard data provider plugin
 * via the event bus and returns typed results. The hook is completely
 * plugin-agnostic — it does not know or care which plugin responds.
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useDashboardQuery<DashboardData>(
 *   NETWORK_OVERVIEW_QUERY,
 *   undefined,
 *   { pollInterval: 30_000 }
 * );
 * ```
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useShell } from '@/contexts/shell-context';
import {
  DASHBOARD_QUERY_EVENT,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
} from '@naap/plugin-sdk';

// ============================================================================
// Types
// ============================================================================

export type DashboardErrorType = 'no-provider' | 'timeout' | 'query-error' | 'unknown';

export interface DashboardError {
  type: DashboardErrorType;
  message: string;
}

export interface UseDashboardQueryOptions {
  /** Polling interval in ms. Set to 0 or undefined to disable polling. */
  pollInterval?: number;
  /** Timeout for the event bus request in ms (default: 8000). */
  timeout?: number;
  /** Whether to skip the query (useful for conditional fetching). */
  skip?: boolean;
}

export interface UseDashboardQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: DashboardError | null;
  refetch: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useDashboardQuery<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  options?: UseDashboardQueryOptions
): UseDashboardQueryResult<T> {
  const { pollInterval, timeout = 8000, skip = false } = options ?? {};
  const shell = useShell();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<DashboardError | null>(null);

  // Stable refs to avoid re-triggering effects on every render
  const queryRef = useRef(query);
  const variablesRef = useRef(variables);
  const mountedRef = useRef(true);

  queryRef.current = query;
  variablesRef.current = variables;

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    try {
      const request: DashboardQueryRequest = {
        query: queryRef.current,
        variables: variablesRef.current,
      };

      const response = await shell.eventBus.request<
        DashboardQueryRequest,
        DashboardQueryResponse
      >(DASHBOARD_QUERY_EVENT, request, { timeout });

      if (!mountedRef.current) return;

      if (response.errors && response.errors.length > 0 && !response.data) {
        setError({
          type: 'query-error',
          message: response.errors.map((e) => e.message).join('; '),
        });
        setData(null);
      } else {
        setData((response.data as T) ?? null);
        // Partial errors: data is present but some fields had errors
        if (response.errors && response.errors.length > 0) {
          console.warn('[useDashboardQuery] Partial errors:', response.errors);
        }
        setError(null);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const code = (err as any)?.code;
      if (code === 'NO_HANDLER') {
        setError({ type: 'no-provider', message: 'No dashboard data provider is registered' });
      } else if (code === 'TIMEOUT') {
        setError({ type: 'timeout', message: 'Dashboard data provider did not respond in time' });
      } else {
        setError({
          type: 'unknown',
          message: (err as Error)?.message ?? 'Unknown error fetching dashboard data',
        });
      }
      setData(null);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [shell.eventBus, timeout]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    if (!skip) {
      fetchData();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, skip]);

  // Polling
  useEffect(() => {
    if (!pollInterval || pollInterval <= 0 || skip) return;

    const intervalId = setInterval(() => {
      fetchData();
    }, pollInterval);

    return () => clearInterval(intervalId);
  }, [fetchData, pollInterval, skip]);

  return { data, loading, error, refetch: fetchData };
}
