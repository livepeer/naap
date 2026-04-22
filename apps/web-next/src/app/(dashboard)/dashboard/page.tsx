'use client';

/**
 * Dashboard Overview Page (authenticated)
 *
 * Network status overview showing key metrics, performance, costs, and live activity.
 * Data is fetched via the event bus from a provider plugin.
 * Rendering is delegated to the shared OverviewContent component.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import { useJobFeedStream } from '@/hooks/useJobFeedStream';
import { OverviewContent } from '@/components/dashboard/overview-content';
import type { DashboardData, DashboardKPI, DashboardOrchestrator } from '@naap/plugin-sdk';
import { AlertCircle } from 'lucide-react';
import {
  DEFAULT_OVERVIEW_TIMEFRAME,
  OVERVIEW_TIMEFRAME_VALUES,
} from '@/lib/dashboard/overview-timeframe';

// ============================================================================
// GraphQL Queries
// ============================================================================

const NAAP_API_QUERY = /* GraphQL */ `
  query NaapApiData($timeframe: String) {
    kpi(timeframe: $timeframe) {
      successRate { value delta }
      orchestratorsObserved { value delta }
      dailyUsageMins { value delta }
      dailySessionCount { value delta }
      timeframeHours
      hourlyUsage { hour value }
      hourlySessions { hour value }
    }
    pipelines(limit: 200, timeframe: $timeframe) {
      name mins sessions avgFps color modelMins { model mins sessions avgFps }
    }
    pipelineCatalog {
      id name models regions
    }
  }
`;

const REALTIME_QUERY = /* GraphQL */ `
  query RealtimeData($timeframe: String) {
    protocol {
      currentRound
      blockProgress
      totalBlocks
      totalStakedLPT
    }
    gpuCapacity(timeframe: $timeframe) {
      totalGPUs
      activeGPUs
      models { model count }
      pipelineGPUs { name gpus models { model gpus } }
    }
    pricing {
      pipeline model unit price avgWeiPerUnit pixelsPerUnit outputPerDollar capacity
    }
  }
`;

const FEES_OVERVIEW_QUERY = /* GraphQL */ `
  query FeesOverview {
    fees(days: 180) {
      totalEth
      totalUsd
      oneDayVolumeUsd
      oneDayVolumeEth
      oneWeekVolumeUsd
      oneWeekVolumeEth
      volumeChangeUsd
      volumeChangeEth
      weeklyVolumeChangeUsd
      weeklyVolumeChangeEth
      dayData { dateS volumeEth volumeUsd }
      weeklyData { date weeklyVolumeUsd weeklyVolumeEth }
    }
  }
`;

const NAAP_API_QUERY_TIMEOUT_MS = 25_000;
const REALTIME_QUERY_TIMEOUT_MS = 15_000;

// ============================================================================
// State helpers
// ============================================================================

const POLL_INTERVAL_KEY = 'naap_dashboard_poll_interval';
const DEFAULT_POLL_INTERVAL = 15_000;
const TIMEFRAME_KEY = 'naap_dashboard_timeframe';
type OverviewTimeframe = (typeof OVERVIEW_TIMEFRAME_VALUES)[number];

const JOB_FEED_POLL_OPTIONS = [5_000, 15_000, 30_000, 90_000];

function getStoredJobFeedPollInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_POLL_INTERVAL;
  const stored = localStorage.getItem(POLL_INTERVAL_KEY);
  if (!stored) return DEFAULT_POLL_INTERVAL;
  const parsed = Number(stored);
  return JOB_FEED_POLL_OPTIONS.includes(parsed) ? parsed : DEFAULT_POLL_INTERVAL;
}

function getStoredTimeframe(): OverviewTimeframe {
  if (typeof window === 'undefined') return DEFAULT_OVERVIEW_TIMEFRAME;
  const stored = localStorage.getItem(TIMEFRAME_KEY);
  if (!stored) return DEFAULT_OVERVIEW_TIMEFRAME;
  return OVERVIEW_TIMEFRAME_VALUES.includes(stored as OverviewTimeframe)
    ? (stored as OverviewTimeframe)
    : DEFAULT_OVERVIEW_TIMEFRAME;
}

// ============================================================================
// Page Component
// ============================================================================

function NoProviderMessage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <AlertCircle className="w-8 h-8 mb-3 opacity-50" />
      <p className="text-sm font-medium">No dashboard data provider installed</p>
      <p className="text-xs mt-1 opacity-70">Install a dashboard provider plugin to see network data</p>
    </div>
  );
}

export default function DashboardPage() {
  const [jobFeedPollInterval, setJobFeedPollInterval] = useState(DEFAULT_POLL_INTERVAL);
  const [timeframe, setTimeframe] = useState<OverviewTimeframe>(DEFAULT_OVERVIEW_TIMEFRAME);
  const [prefsReady, setPrefsReady] = useState(false);
  const [orchestrators, setOrchestrators] = useState<DashboardOrchestrator[]>([]);
  const [fetchedOrchestratorsTimeframe, setFetchedOrchestratorsTimeframe] = useState<string | null>(null);
  const [orchestratorsLoading, setOrchestratorsLoading] = useState(true);
  /**
   * Orchestrator snapshot fields come from the BFF (same resolver as GraphQL would use)
   * because the dashboard provider plugin bundles an older GraphQL schema that may not
   * yet include `orchestratorsWindowHours` on type KPI.
   */
  const [orchKpiFromBff, setOrchKpiFromBff] = useState<Pick<
    DashboardKPI,
    'orchestratorsObserved' | 'orchestratorsWindowHours'
  > | null>(null);

  useEffect(() => {
    setJobFeedPollInterval(getStoredJobFeedPollInterval());
    setTimeframe(getStoredTimeframe());
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    setOrchestratorsLoading(true);
    const qs = new URLSearchParams({ period: timeframe });
    void fetch(`/api/v1/dashboard/orchestrators?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error('Invalid orchestrators response');
        return body as DashboardOrchestrator[];
      })
      .then((rows) => {
        if (!cancelled) {
          setOrchestrators(rows);
          setFetchedOrchestratorsTimeframe(timeframe);
          setOrchestratorsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedOrchestratorsTimeframe(null);
          setOrchestratorsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [prefsReady, timeframe]);

  useEffect(() => {
    if (!prefsReady) return;
    let cancelled = false;
    const url = `/api/v1/dashboard/kpi?timeframe=${encodeURIComponent(timeframe)}`;
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DashboardKPI>;
      })
      .then((body) => {
        if (!cancelled) {
          setOrchKpiFromBff({
            orchestratorsObserved: body.orchestratorsObserved,
            orchestratorsWindowHours: body.orchestratorsWindowHours,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setOrchKpiFromBff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [prefsReady, timeframe]);

  const handleJobFeedPollIntervalChange = (ms: number) => {
    setJobFeedPollInterval(ms);
    localStorage.setItem(POLL_INTERVAL_KEY, String(ms));
  };

  const handleTimeframeChange = (tf: string) => {
    if (!OVERVIEW_TIMEFRAME_VALUES.includes(tf as OverviewTimeframe)) return;
    const next = tf as OverviewTimeframe;
    setTimeframe(next);
    localStorage.setItem(TIMEFRAME_KEY, next);
  };

  const {
    data: lbData,
    loading: lbLoading,
    refreshing: lbRefreshing,
    error: lbError,
  } = useDashboardQuery<Pick<DashboardData, 'kpi' | 'pipelines' | 'pipelineCatalog'>>(
    NAAP_API_QUERY,
    { timeframe },
    { timeout: NAAP_API_QUERY_TIMEOUT_MS, skip: !prefsReady },
  );

  const {
    data: rtData,
    loading: rtLoading,
    refreshing: rtRefreshing,
    error: rtError,
  } = useDashboardQuery<Pick<DashboardData, 'protocol' | 'gpuCapacity' | 'pricing'>>(
    REALTIME_QUERY,
    { timeframe },
    { timeout: REALTIME_QUERY_TIMEOUT_MS, skip: !prefsReady },
  );

  const {
    data: feesData,
    loading: feesLoading,
    refreshing: feesRefreshing,
    error: feesError,
  } = useDashboardQuery<Pick<DashboardData, 'fees'>>(
    FEES_OVERVIEW_QUERY,
    undefined,
    { timeout: NAAP_API_QUERY_TIMEOUT_MS, skip: !prefsReady },
  );

  const {
    jobs,
    connected: jobFeedConnected,
    feedMeta: jobFeedMeta,
    error: jobFeedError,
    jobFeedLoading,
  } = useJobFeedStream({
    maxItems: 50,
    pollInterval: jobFeedPollInterval,
  });

  const mergedKpi = useMemo((): DashboardKPI | null => {
    const base = lbData?.kpi;
    if (!base) return null;
    if (!orchKpiFromBff) return base;
    return {
      ...base,
      orchestratorsObserved: orchKpiFromBff.orchestratorsObserved,
      orchestratorsWindowHours: orchKpiFromBff.orchestratorsWindowHours,
    };
  }, [lbData?.kpi, orchKpiFromBff]);

  if (lbError?.type === 'no-provider' && !lbData) {
    return <NoProviderMessage />;
  }

  const visibleOrchestrators =
    fetchedOrchestratorsTimeframe === timeframe ? orchestrators : [];

  return (
    <OverviewContent
      isPublic={false}
      kpi={mergedKpi}
      pipelines={lbData?.pipelines ?? []}
      pipelineCatalog={lbData?.pipelineCatalog ?? []}
      orchestrators={visibleOrchestrators}
      orchestratorsLoading={orchestratorsLoading}
      protocol={rtData?.protocol ?? null}
      gpuCapacity={rtData?.gpuCapacity ?? null}
      pricing={rtData?.pricing ?? []}
      fees={feesData?.fees ?? null}
      jobs={jobs}
      jobFeedConnected={jobFeedConnected}
      jobFeedPollInterval={jobFeedPollInterval}
      onJobFeedPollIntervalChange={handleJobFeedPollIntervalChange}
      jobFeedMeta={jobFeedMeta}
      jobFeedError={jobFeedError}
      jobFeedLoading={jobFeedLoading}
      timeframe={timeframe}
      onTimeframeChange={handleTimeframeChange}
      lbLoading={lbLoading}
      rtLoading={rtLoading}
      feesLoading={feesLoading}
      lbRefreshing={lbRefreshing}
      rtRefreshing={rtRefreshing}
      feesRefreshing={feesRefreshing}
      lbError={lbError}
      rtError={rtError}
      feesError={feesError}
      prefsReady={prefsReady}
    />
  );
}
