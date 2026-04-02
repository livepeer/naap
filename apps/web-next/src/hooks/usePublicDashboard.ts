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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    try {
      const period = timeframeToPeriod(timeframe);
      const [kpi, pipelines, catalog, orchestrators, protocol, gpuCap, pricing, fees, jobFeedRaw] =
        await Promise.all([
          fetchJson<DashboardKPI>(`${API}/kpi?timeframe=${timeframe}`),
          fetchJson<DashboardPipelineUsage[]>(`${API}/pipelines?timeframe=${timeframe}&limit=50`),
          fetchJson<DashboardPipelineCatalogEntry[]>(`${API}/pipeline-catalog`),
          fetchJson<DashboardOrchestrator[]>(`${API}/orchestrators?period=${period}`),
          fetchJson<DashboardProtocol>(`${API}/protocol`),
          fetchJson<DashboardGPUCapacity>(`${API}/gpu-capacity?timeframe=${timeframe}`),
          fetchJson<DashboardPipelinePricing[]>(`${API}/pricing`),
          fetchJson<DashboardFeesInfo>(`${API}/fees?days=180`),
          fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(`${API}/job-feed`),
        ]);

      if (!mountedRef.current) return;

      setData({
        kpi: kpi,
        pipelines: pipelines ?? [],
        pipelineCatalog: catalog ?? [],
        orchestrators: orchestrators ?? [],
        protocol: protocol,
        gpuCapacity: gpuCap,
        pricing: pricing ?? [],
        fees: fees,
        jobs: jobFeedRaw?.streams ?? [],
        jobFeedConnected: !!(jobFeedRaw && !jobFeedRaw.queryFailed),
      });
      setError(null);
      hasFetchedRef.current = true;
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err as Error)?.message ?? 'Failed to fetch dashboard data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [timeframe]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    if (!skip) fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll, skip]);

  // Job feed polling (only polls job-feed, not everything)
  useEffect(() => {
    if (skip || !jobFeedPollInterval || jobFeedPollInterval <= 0) return;
    if (!hasFetchedRef.current) return;

    const id = setInterval(async () => {
      const result = await fetchJson<{ streams: JobFeedEntry[]; queryFailed?: boolean }>(`${API}/job-feed`);
      if (mountedRef.current && result) {
        setData(prev => ({
          ...prev,
          jobs: result.streams ?? [],
          jobFeedConnected: !result.queryFailed,
        }));
      }
    }, jobFeedPollInterval);

    return () => clearInterval(id);
  }, [skip, jobFeedPollInterval]);

  const refreshing = loading && hasFetchedRef.current;

  return { data, loading, refreshing, error, refetch: fetchAll };
}
