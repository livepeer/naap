/**
 * useQuery & useMutation Hooks
 *
 * Data fetching hooks that eliminate manual useState/useEffect patterns in plugins.
 * Built on top of the shell-provided IApiClient.
 *
 * @example
 * ```tsx
 * function OrchestorList() {
 *   const { data, loading, error, refetch } = useQuery('orchestrators', () =>
 *     api.get<Orchestrator[]>('/api/v1/livepeer/orchestrators')
 *   );
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error.message} />;
 *   return <List items={data} />;
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const queryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_STALE_TIME = 30_000; // 30 seconds

// ─── useQuery ───────────────────────────────────────────────────────────────

export interface UseQueryOptions<T> {
  /** Whether the query should execute immediately (default: true) */
  enabled?: boolean;

  /** Time in ms before cached data is considered stale (default: 30000) */
  staleTime?: number;

  /** Whether to refetch when the component re-mounts (default: false) */
  refetchOnMount?: boolean;

  /** Interval in ms to automatically refetch (disabled by default) */
  refetchInterval?: number;

  /** Callback when data is successfully fetched */
  onSuccess?: (data: T) => void;

  /** Callback when fetch fails */
  onError?: (error: Error) => void;

  /** Initial data to use before fetch completes */
  initialData?: T;
}

export interface UseQueryResult<T> {
  /** The fetched data (undefined while loading, unless initialData is provided) */
  data: T | undefined;

  /** Whether the query is currently fetching */
  loading: boolean;

  /** Error if the query failed */
  error: Error | null;

  /** Whether data exists (from cache or fetch) */
  isSuccess: boolean;

  /** Whether data is stale (older than staleTime) */
  isStale: boolean;

  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
}

/**
 * Hook for declarative data fetching with caching, loading states, and error handling.
 *
 * @param key - Unique cache key for this query (null to disable the query)
 * @param fetcher - Async function that returns the data
 * @param options - Query options
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const {
    enabled = true,
    staleTime = DEFAULT_STALE_TIME,
    refetchOnMount = false,
    refetchInterval,
    onSuccess,
    onError,
    initialData,
  } = options;

  const [data, setData] = useState<T | undefined>(() => {
    // Check cache first (skip if key is null)
    if (!key) return initialData;
    const cached = queryCache.get(key) as CacheEntry<T> | undefined;
    if (cached && Date.now() - cached.timestamp < staleTime) {
      return cached.data;
    }
    return initialData;
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (!key) return false;
    const cached = queryCache.get(key);
    return enabled && (!cached || Date.now() - cached.timestamp >= staleTime);
  });

  const [error, setError] = useState<Error | null>(null);

  // Track mounted state to avoid setState on unmounted component
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();

      if (!mountedRef.current) return;

      // Update cache (only if key is defined)
      if (key) {
        queryCache.set(key, { data: result, timestamp: Date.now() });
      }

      setData(result);
      setLoading(false);

      onSuccessRef.current?.(result);
    } catch (err) {
      if (!mountedRef.current) return;

      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setLoading(false);

      onErrorRef.current?.(error);
    }
  }, [key]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;

    // Skip if key is null or disabled
    if (!key || !enabled) {
      setLoading(false);
      return;
    }

    const cached = queryCache.get(key) as CacheEntry<T> | undefined;
    const isStale = !cached || Date.now() - cached.timestamp >= staleTime;

    if (isStale || refetchOnMount) {
      fetchData();
    } else if (cached) {
      setData(cached.data);
      setLoading(false);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [key, enabled, fetchData, staleTime, refetchOnMount]);

  // Refetch interval
  useEffect(() => {
    if (!key || !refetchInterval || !enabled) return;

    const interval = setInterval(fetchData, refetchInterval);
    return () => clearInterval(interval);
  }, [refetchInterval, enabled, fetchData]);

  const isStale = (() => {
    if (!key) return true;
    const cached = queryCache.get(key);
    return !cached || Date.now() - cached.timestamp >= staleTime;
  })();

  return {
    data,
    loading,
    error,
    isSuccess: data !== undefined,
    isStale,
    refetch: fetchData,
  };
}

// ─── useMutation ────────────────────────────────────────────────────────────

export interface UseMutationOptions<TData, TVariables> {
  /** Callback when mutation succeeds */
  onSuccess?: (data: TData, variables: TVariables) => void;

  /** Callback when mutation fails */
  onError?: (error: Error, variables: TVariables) => void;

  /** Cache keys to invalidate on success */
  invalidateKeys?: string[];

  /** Whether to perform optimistic update (requires onSuccess to handle rollback) */
  optimistic?: boolean;
}

export interface UseMutationResult<TData, TVariables> {
  /** Execute the mutation */
  mutate: (variables: TVariables) => Promise<TData>;

  /** The result data from the last successful mutation */
  data: TData | undefined;

  /** Whether the mutation is in progress */
  loading: boolean;

  /** Error from the last mutation attempt */
  error: Error | null;

  /** Whether the last mutation was successful */
  isSuccess: boolean;

  /** Reset mutation state */
  reset: () => void;
}

/**
 * Hook for data mutations (create, update, delete) with loading/error states.
 *
 * @param mutator - Async function that performs the mutation
 * @param options - Mutation options
 *
 * @example
 * ```tsx
 * function CreatePost() {
 *   const { mutate, loading } = useMutation(
 *     (post: NewPost) => api.post<Post>('/api/v1/community/posts', post),
 *     {
 *       onSuccess: () => notify.success('Post created!'),
 *       invalidateKeys: ['posts'],
 *     }
 *   );
 *
 *   return <button onClick={() => mutate({ title: 'Hello' })} disabled={loading}>Create</button>;
 * }
 * ```
 */
export function useMutation<TData = unknown, TVariables = unknown>(
  mutator: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TVariables> = {}
): UseMutationResult<TData, TVariables> {
  const { onSuccess, onError, invalidateKeys } = options;

  const [data, setData] = useState<TData | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const mutatorRef = useRef(mutator);
  mutatorRef.current = mutator;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const mutate = useCallback(async (variables: TVariables): Promise<TData> => {
    setLoading(true);
    setError(null);
    setIsSuccess(false);

    try {
      const result = await mutatorRef.current(variables);

      setData(result);
      setLoading(false);
      setIsSuccess(true);

      // Invalidate cache for related queries
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          queryCache.delete(key);
        }
      }

      onSuccessRef.current?.(result, variables);

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setLoading(false);
      setIsSuccess(false);

      onErrorRef.current?.(error, variables);

      throw error;
    }
  }, [invalidateKeys]);

  const reset = useCallback(() => {
    setData(undefined);
    setLoading(false);
    setError(null);
    setIsSuccess(false);
  }, []);

  return { mutate, data, loading, error, isSuccess, reset };
}

// ─── Cache Utilities ────────────────────────────────────────────────────────

/**
 * Invalidate specific cache keys. Useful for manual cache invalidation.
 */
export function invalidateQueries(keys: string[]): void {
  for (const key of keys) {
    queryCache.delete(key);
  }
}

/**
 * Clear the entire query cache.
 */
export function clearQueryCache(): void {
  queryCache.clear();
}
