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

function jobFeedDashboardUrl(pollMs: number, bustCache = false): string {
  const ms = pollMs >= 1000 ? pollMs : 30_000;
  const base = `${API}/job-feed?pollMs=${encodeURIComponent(String(ms))}`;
  return bustCache ? `${base}&refresh=1` : base;
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
  const fetchLb = useCallback(async (options?: { bustJobFeedCache?: boolean }) => {
    if (!mountedRef.current) return;
    setLbLoading(true);

    const period = timeframeToPeriod(timeframe);
    const jobFeedUrl = jobFeedDashboardUrl(jobFeedPollInterval, options?.bustJobFeedCache ?? false);
    const settled = await Promise.allSettled([
      fetchJson<DashboardKPI>(`${API}/kpi?timeframe=${timeframe}`),
      fetchJson<DashboardPipelineUsage[]>(`${API}/pipelines?timeframe=${timeframe}&limit=200`),
      fetchJson<DashboardPipelineCatalogEntry[]>(`${API}/pipeline-catalog`),
      fetchJson<DashboardOrchestrator[]>(`${API}/orchestrators?period=${period}`),
      fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(jobFeedUrl),
    ]);

    if (!mountedRef.current) return;

    const val = (r: PromiseSettledResult<unknown>) =>
      r.status === 'fulfilled' ? r.value : null;

    const kpi = val(settled[0]) as DashboardKPI | null;
    const pipelines = val(settled[1]) as DashboardPipelineUsage[] | null;
    const catalog = val(settled[2]) as DashboardPipelineCatalogEntry[] | null;
    const orchestrators = val(settled[3]) as DashboardOrchestrator[] | null;
    const jobFeedRaw = val(settled[4]) as {
      streams: JobFeedEntry[];
      queryFailed?: boolean;
    } | null;

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
  }, [timeframe, jobFeedPollInterval, syncError]);

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

    const val = (r: PromiseSettledResult<unknown>) =>
      r.status === 'fulfilled' ? r.value : null;

    const protocol = val(settled[0]) as DashboardProtocol | null;
    const gpuCap = val(settled[1]) as DashboardGPUCapacity | null;
    const pricing = val(settled[2]) as DashboardPipelinePricing[] | null;

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData((prev) => ({
      ...prev,
      protocol,
      gpuCapacity: gpuCap,
      pricing: pricing ?? [],
    }));

    errorsRef.current = [...errorsRef.current.filter((e) => !e.includes('/protocol') && !e.includes('/gpu-capacity') && !e.includes('/pricing')), ...failures];
    syncError();
    setRtHasFetched(true);
    setRtLoading(false);
  }, [timeframe, syncError]);

  // Group 3: fees
  const fetchFees = useCallback(async () => {
    if (!mountedRef.current) return;
    setFeesLoading(true);

    try {
      const fees = await fetchJson<DashboardFeesInfo>(`${API}/fees?days=180`);
      if (!mountedRef.current) return;
      setData((prev) => ({ ...prev, fees }));
      errorsRef.current = errorsRef.current.filter((e) => !e.includes('/fees'));
    } catch (err) {
      if (!mountedRef.current) return;
      setData((prev) => ({ ...prev, fees: null }));
      errorsRef.current = [...errorsRef.current.filter((e) => !e.includes('/fees')), (err as Error)?.message ?? 'Fees fetch failed'];
    }

    syncError();
    setFeesHasFetched(true);
    setFeesLoading(false);
  }, [syncError]);

  const refetch = useCallback(() => {
    fetchLb({ bustJobFeedCache: true });
    fetchRt();
    fetchFees();
  }, [fetchLb, fetchRt, fetchFees]);

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
