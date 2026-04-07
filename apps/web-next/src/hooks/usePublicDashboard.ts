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
  jobFeedLoading: boolean;
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

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
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
  const [jobFeedLoading, setJobFeedLoading] = useState(!skip);
  const [lbHasFetched, setLbHasFetched] = useState(false);
  const [jobFeedHasFetched, setJobFeedHasFetched] = useState(false);
  const [rtHasFetched, setRtHasFetched] = useState(false);
  const [feesHasFetched, setFeesHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const errorsRef = useRef<string[]>([]);

  const syncError = useCallback(() => {
    setError(errorsRef.current.length > 0 ? errorsRef.current.join('; ') : null);
  }, []);

  // Group 1: KPI, pipelines, catalog, orchestrators
  const fetchLb = useCallback(async () => {
    if (!mountedRef.current) return;
    setLbLoading(true);

    const excludedPaths = ['/kpi', '/pipelines', '/pipeline-catalog', '/orchestrators'];
    const period = timeframeToPeriod(timeframe);
    const settled = await Promise.allSettled([
      fetchJson<DashboardKPI>(`${API}/kpi?timeframe=${timeframe}`),
      fetchJson<DashboardPipelineUsage[]>(`${API}/pipelines?timeframe=${timeframe}&limit=200`),
      fetchJson<DashboardPipelineCatalogEntry[]>(`${API}/pipeline-catalog`),
      fetchJson<DashboardOrchestrator[]>(`${API}/orchestrators?period=${period}`),
    ]);

    if (!mountedRef.current) return;

    const kpi = settledValue(settled[0]);
    const pipelines = settledValue(settled[1]);
    const catalog = settledValue(settled[2]);
    const orchestrators = settledValue(settled[3]);

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData((prev) => ({
      ...prev,
      kpi,
      pipelines: pipelines ?? [],
      pipelineCatalog: catalog ?? [],
      orchestrators: orchestrators ?? [],
    }));

    errorsRef.current = [
      ...errorsRef.current.filter((entry) => !excludedPaths.some((path) => entry.includes(path))),
      ...failures,
    ];
    syncError();
    setLbHasFetched(true);
    setLbLoading(false);
  }, [timeframe, syncError]);

  // Group 1b: job feed — independent so slow upstream doesn't block KPI/pipelines
  const fetchJobFeed = useCallback(async (options?: { bustCache?: boolean }) => {
    if (!mountedRef.current) return;
    setJobFeedLoading(true);
    const url = jobFeedDashboardUrl(jobFeedPollInterval, options?.bustCache ?? false);
    try {
      const result = await fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(url);
      if (!mountedRef.current) return;
      setData((prev) => ({
        ...prev,
        jobs: result.streams ?? [],
        jobFeedConnected: !result.queryFailed,
      }));
      setJobFeedHasFetched(true);
      errorsRef.current = errorsRef.current.filter((e) => !e.includes('/job-feed'));
    } catch (err) {
      if (!mountedRef.current) return;
      errorsRef.current = [...errorsRef.current.filter((e) => !e.includes('/job-feed')), (err as Error)?.message ?? 'Job feed fetch failed'];
    }
    syncError();
    setJobFeedLoading(false);
  }, [jobFeedPollInterval, syncError]);

  // Group 2: protocol, GPU capacity, pricing
  const fetchRt = useCallback(async () => {
    if (!mountedRef.current) return;
    setRtLoading(true);

    const excludedPaths = ['/protocol', '/gpu-capacity', '/pricing'];
    const settled = await Promise.allSettled([
      fetchJson<DashboardProtocol>(`${API}/protocol`),
      fetchJson<DashboardGPUCapacity>(`${API}/gpu-capacity?timeframe=${timeframe}`),
      fetchJson<DashboardPipelinePricing[]>(`${API}/pricing`),
    ]);

    if (!mountedRef.current) return;

    const protocol = settledValue(settled[0]);
    const gpuCap = settledValue(settled[1]);
    const pricing = settledValue(settled[2]);

    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as Error)?.message ?? 'Unknown error');

    setData((prev) => ({
      ...prev,
      protocol,
      gpuCapacity: gpuCap,
      pricing: pricing ?? [],
    }));

    errorsRef.current = [
      ...errorsRef.current.filter((entry) => !excludedPaths.some((path) => entry.includes(path))),
      ...failures,
    ];
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
    fetchLb();
    fetchJobFeed({ bustCache: true });
    fetchRt();
    fetchFees();
  }, [fetchLb, fetchJobFeed, fetchRt, fetchFees]);

  // Track whether the component has mounted so the timeframe-change effect can
  // skip its first run (the mount effect handles the initial fetch).
  const hasMountedRef = useRef(false);
  const prevTimeframeRef = useRef(timeframe);

  // Initial mount — fire all four groups concurrently.
  useEffect(() => {
    mountedRef.current = true;
    hasMountedRef.current = false;
    if (!skip) {
      hasMountedRef.current = true;
      prevTimeframeRef.current = timeframe;
      setJobFeedHasFetched(false);
      fetchLb();
      fetchJobFeed();
      fetchRt();
      fetchFees();
    }
    return () => {
      mountedRef.current = false;
      hasMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  // Timeframe change — only refetch the time-dependent groups (lb + rt).
  // Fees and job-feed are not timeframe-scoped, so skip them here.
  useEffect(() => {
    if (!hasMountedRef.current) return;
    if (prevTimeframeRef.current === timeframe) return;
    prevTimeframeRef.current = timeframe;
    if (!skip) {
      fetchLb();
      fetchRt();
    }
  }, [timeframe, skip, fetchLb, fetchRt]);

  // Job feed polling — starts after the initial job feed fetch
  useEffect(() => {
    if (skip || !jobFeedHasFetched || !jobFeedPollInterval || jobFeedPollInterval <= 0) return;

    const id = setInterval(() => {
      void fetchJobFeed();
    }, jobFeedPollInterval);

    return () => clearInterval(id);
  }, [skip, jobFeedHasFetched, jobFeedPollInterval, fetchJobFeed]);

  return {
    data,
    lbLoading,
    rtLoading,
    feesLoading,
    jobFeedLoading,
    lbRefreshing: lbLoading && lbHasFetched,
    rtRefreshing: rtLoading && rtHasFetched,
    feesRefreshing: feesLoading && feesHasFetched,
    error,
    refetch,
  };
}
