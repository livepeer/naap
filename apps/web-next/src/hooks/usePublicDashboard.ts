'use client';

/**
 * usePublicDashboard Hook
 *
 * Fetches dashboard data directly from REST API routes, bypassing the
 * event bus / plugin system. Used for the public (unauthenticated) overview
 * where PluginProvider does not load plugins.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  DashboardKPI,
  DashboardPipelineUsage,
  DashboardPipelineCatalogEntry,
  DashboardOrchestrator,
  DashboardProtocol,
  DashboardGPUCapacity,
  DashboardPipelinePricing,
  DashboardFeesInfo,
  JobFeedEntry,
} from '@naap/plugin-sdk';

export interface PublicDashboardData {
  kpi: DashboardKPI | null;
  pipelines: DashboardPipelineUsage[];
  pipelineCatalog: DashboardPipelineCatalogEntry[];
  orchestrators: DashboardOrchestrator[];
  protocol: DashboardProtocol | null;
  gpuCapacity: DashboardGPUCapacity | null;
  pricing: DashboardPipelinePricing[];
  fees: DashboardFeesInfo | null;
  jobs: JobFeedEntry[];
  jobFeedConnected: boolean;
}

export interface UsePublicDashboardOptions {
  timeframe?: string;
  jobFeedPollInterval?: number;
  skip?: boolean;
}

export interface UsePublicDashboardResult {
  data: PublicDashboardData;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

const API = '/api/v1/dashboard';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

function timeframeToPeriod(tf: string): string {
  const h = parseInt(tf, 10);
  if (!Number.isFinite(h) || h <= 0) return '24h';
  return `${h}h`;
}

export function usePublicDashboard(
  options?: UsePublicDashboardOptions,
): UsePublicDashboardResult {
  const { timeframe = '12', jobFeedPollInterval = 15_000, skip = false } = options ?? {};

  const [data, setData] = useState<PublicDashboardData>({
    kpi: null,
    pipelines: [],
    pipelineCatalog: [],
    orchestrators: [],
    protocol: null,
    gpuCapacity: null,
    pricing: [],
    fees: null,
    jobs: [],
    jobFeedConnected: false,
  });
  const [loading, setLoading] = useState(!skip);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    const period = timeframeToPeriod(timeframe);
    const settled = await Promise.allSettled([
      fetchJson<DashboardKPI>(`${API}/kpi?timeframe=${timeframe}`),
      fetchJson<DashboardPipelineUsage[]>(`${API}/pipelines?timeframe=${timeframe}&limit=200`),
      fetchJson<DashboardPipelineCatalogEntry[]>(`${API}/pipeline-catalog`),
      fetchJson<DashboardOrchestrator[]>(`${API}/orchestrators?period=${period}`),
      fetchJson<DashboardProtocol>(`${API}/protocol`),
      fetchJson<DashboardGPUCapacity>(`${API}/gpu-capacity?timeframe=${timeframe}`),
      fetchJson<DashboardPipelinePricing[]>(`${API}/pricing`),
      fetchJson<DashboardFeesInfo>(`${API}/fees?days=180`),
      fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(`${API}/job-feed`),
    ]);

    if (!mountedRef.current) return;

    const val = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' ? r.value : null;

    const [kpi, pipelines, catalog, orchestrators, protocol, gpuCap, pricing, fees, jobFeedRaw] =
      settled.map(val) as [
        DashboardKPI | null, DashboardPipelineUsage[] | null,
        DashboardPipelineCatalogEntry[] | null, DashboardOrchestrator[] | null,
        DashboardProtocol | null, DashboardGPUCapacity | null,
        DashboardPipelinePricing[] | null, DashboardFeesInfo | null,
        { streams: JobFeedEntry[]; queryFailed?: boolean } | null,
      ];

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData({
      kpi,
      pipelines: pipelines ?? [],
      pipelineCatalog: catalog ?? [],
      orchestrators: orchestrators ?? [],
      protocol,
      gpuCapacity: gpuCap,
      pricing: pricing ?? [],
      fees,
      jobs: jobFeedRaw?.streams ?? [],
      jobFeedConnected: !!(jobFeedRaw && !jobFeedRaw.queryFailed),
    });
    setError(failures.length > 0 ? failures.join('; ') : null);
    setHasFetched(true);
    setLoading(false);
  }, [timeframe]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    if (!skip) fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll, skip]);

  // Job feed polling — starts after the initial fetch completes (hasFetched is reactive)
  useEffect(() => {
    if (skip || !hasFetched || !jobFeedPollInterval || jobFeedPollInterval <= 0) return;

    const id = setInterval(async () => {
      try {
        const result = await fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(`${API}/job-feed`);
        if (mountedRef.current && result) {
          setData(prev => ({
            ...prev,
            jobs: result.streams ?? [],
            jobFeedConnected: !result.queryFailed,
          }));
        }
      } catch {
        // polling failure is non-critical; next tick will retry
      }
    }, jobFeedPollInterval);

    return () => clearInterval(id);
  }, [skip, hasFetched, jobFeedPollInterval]);

  const refreshing = loading && hasFetched;

  return { data, loading, refreshing, error, refetch: fetchAll };
}
