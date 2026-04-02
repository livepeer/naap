'use client';

/**
 * usePublicDashboard Hook
 *
 * Fetches dashboard data directly from REST API routes, bypassing the
 * event bus / plugin system. Used for the public (unauthenticated) overview
 * where PluginProvider does not load plugins.
 *
 * Data is split into three independent fetch groups matching the
 * authenticated dashboard's query structure so each section renders
 * progressively as its data arrives:
 *   - lb: KPI, pipelines, catalog, orchestrators  (+ job feed)
 *   - rt: protocol, GPU capacity, pricing
 *   - fees: fee history
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
  lbLoading: boolean;
  rtLoading: boolean;
  feesLoading: boolean;
  lbRefreshing: boolean;
  rtRefreshing: boolean;
  feesRefreshing: boolean;
  error: string | null;
  refetch: () => void;
}

const API = '/api/v1/dashboard';

function jobFeedDashboardUrl(pollMs: number): string {
  const ms = pollMs >= 1000 ? pollMs : 30_000;
  return `${API}/job-feed?pollMs=${encodeURIComponent(String(ms))}`;
}

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

  const [lbLoading, setLbLoading] = useState(!skip);
  const [rtLoading, setRtLoading] = useState(!skip);
  const [feesLoading, setFeesLoading] = useState(!skip);
  const [lbHasFetched, setLbHasFetched] = useState(false);
  const [rtHasFetched, setRtHasFetched] = useState(false);
  const [feesHasFetched, setFeesHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const errorsRef = useRef<string[]>([]);

  const syncError = useCallback(() => {
    setError(errorsRef.current.length > 0 ? errorsRef.current.join('; ') : null);
  }, []);

  // Group 1: KPI, pipelines, catalog, orchestrators, job feed
  const fetchLb = useCallback(async () => {
    if (!mountedRef.current) return;
    setLbLoading(true);

    const period = timeframeToPeriod(timeframe);
    const jobFeedUrl = jobFeedDashboardUrl(jobFeedPollInterval);
    const settled = await Promise.allSettled([
      fetchJson<DashboardKPI>(`${API}/kpi?timeframe=${timeframe}`),
      fetchJson<DashboardPipelineUsage[]>(`${API}/pipelines?timeframe=${timeframe}&limit=200`),
      fetchJson<DashboardPipelineCatalogEntry[]>(`${API}/pipeline-catalog`),
      fetchJson<DashboardOrchestrator[]>(`${API}/orchestrators?period=${period}`),
      fetchJson<DashboardProtocol>(`${API}/protocol`),
      fetchJson<DashboardGPUCapacity>(`${API}/gpu-capacity?timeframe=${timeframe}`),
      fetchJson<DashboardPipelinePricing[]>(`${API}/pricing`),
      fetchJson<DashboardFeesInfo>(`${API}/fees?days=180`),
      fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(jobFeedUrl),
    ]);

    if (!mountedRef.current) return;

    const val = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' ? r.value : null;

    const [kpi, pipelines, catalog, orchestrators, jobFeedRaw] = settled.map(val) as [
      DashboardKPI | null,
      DashboardPipelineUsage[] | null,
      DashboardPipelineCatalogEntry[] | null,
      DashboardOrchestrator[] | null,
      { streams: JobFeedEntry[]; queryFailed?: boolean } | null,
    ];

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData((prev) => ({
      ...prev,
      kpi,
      pipelines: pipelines ?? [],
      pipelineCatalog: catalog ?? [],
      orchestrators: orchestrators ?? [],
      jobs: jobFeedRaw?.streams ?? [],
      jobFeedConnected: !!(jobFeedRaw && !jobFeedRaw.queryFailed),
    }));

    errorsRef.current = [...errorsRef.current.filter((e) => !e.includes('/kpi') && !e.includes('/pipelines') && !e.includes('/pipeline-catalog') && !e.includes('/orchestrators') && !e.includes('/job-feed')), ...failures];
    syncError();
    setLbHasFetched(true);
    setLbLoading(false);
  }, [timeframe, syncError]);

  // Group 2: protocol, GPU capacity, pricing
  const fetchRt = useCallback(async () => {
    if (!mountedRef.current) return;
    setRtLoading(true);

    const settled = await Promise.allSettled([
      fetchJson<DashboardProtocol>(`${API}/protocol`),
      fetchJson<DashboardGPUCapacity>(`${API}/gpu-capacity?timeframe=${timeframe}`),
      fetchJson<DashboardPipelinePricing[]>(`${API}/pricing`),
    ]);

    if (!mountedRef.current) return;

    const val = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === 'fulfilled' ? r.value : null;

    const [protocol, gpuCap, pricing] = settled.map(val) as [
      DashboardProtocol | null,
      DashboardGPUCapacity | null,
      DashboardPipelinePricing[] | null,
    ];

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData((prev) => ({
      ...prev,
      protocol,
      gpuCapacity: gpuCap,
      pricing: pricing ?? [],
      fees,
      jobs: jobFeedRaw?.streams ?? [],
      jobFeedConnected: !!(jobFeedRaw && !jobFeedRaw.queryFailed),
    }));
    setError(failures.length > 0 ? failures.join('; ') : null);
    setHasFetched(true);
    setLoading(false);
  }, [timeframe, jobFeedPollInterval]);

  // Initial fetch — all three groups fire concurrently
  useEffect(() => {
    mountedRef.current = true;
    if (!skip) {
      fetchLb();
      fetchRt();
      fetchFees();
    }
    return () => { mountedRef.current = false; };
  }, [fetchLb, fetchRt, fetchFees, skip]);

  // Job feed polling — starts after the lb group's initial fetch
  useEffect(() => {
    if (skip || !lbHasFetched || !jobFeedPollInterval || jobFeedPollInterval <= 0) return;

    const id = setInterval(async () => {
      try {
        const result = await fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(
          jobFeedDashboardUrl(jobFeedPollInterval),
        );
        if (mountedRef.current && result) {
          setData((prev) => ({
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
  }, [skip, lbHasFetched, jobFeedPollInterval]);

  return {
    data,
    lbLoading,
    rtLoading,
    feesLoading,
    lbRefreshing: lbLoading && lbHasFetched,
    rtRefreshing: rtLoading && rtHasFetched,
    feesRefreshing: feesLoading && feesHasFetched,
    error,
    refetch,
  };
}
