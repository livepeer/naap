'use client';

/**
 * Dashboard Overview Page (authenticated)
 *
 * Network status overview showing key metrics, performance, costs, and live activity.
 * Data is fetched via the event bus from a provider plugin.
 * Rendering is delegated to the shared OverviewContent component.
 */

import { useEffect, useState } from 'react';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import { useJobFeedStream } from '@/hooks/useJobFeedStream';
import { OverviewContent } from '@/components/dashboard/overview-content';
import type { DashboardData } from '@naap/plugin-sdk';
import { AlertCircle } from 'lucide-react';

// ============================================================================
// GraphQL Queries
// ============================================================================

const NAAP_API_QUERY = /* GraphQL */ `
  query NaapApiData($timeframe: String) {
    kpi(timeframe: $timeframe) {
      successRate { value delta }
      orchestratorsOnline { value delta }
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
    orchestrators(period: $timeframe) {
      address uris knownSessions successSessions successRatio effectiveSuccessRate noSwapRatio slaScore pipelines pipelineModels { pipelineId modelIds } gpuCount
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
const DEFAULT_TIMEFRAME = '12';

const JOB_FEED_POLL_OPTIONS = [5_000, 15_000, 30_000, 90_000];
const TIMEFRAME_OPTIONS = ['1', '6', '12', '18', '24'];

function getStoredJobFeedPollInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_POLL_INTERVAL;
  const stored = localStorage.getItem(POLL_INTERVAL_KEY);
  if (!stored) return DEFAULT_POLL_INTERVAL;
  const parsed = Number(stored);
  return JOB_FEED_POLL_OPTIONS.includes(parsed) ? parsed : DEFAULT_POLL_INTERVAL;
}

function getStoredTimeframe(): string {
  if (typeof window === 'undefined') return DEFAULT_TIMEFRAME;
  const stored = localStorage.getItem(TIMEFRAME_KEY);
  if (!stored) return DEFAULT_TIMEFRAME;
  return TIMEFRAME_OPTIONS.includes(stored) ? stored : DEFAULT_TIMEFRAME;
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
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    setJobFeedPollInterval(getStoredJobFeedPollInterval());
    setTimeframe(getStoredTimeframe());
    setPrefsReady(true);
  }, []);

  const handleJobFeedPollIntervalChange = (ms: number) => {
    setJobFeedPollInterval(ms);
    localStorage.setItem(POLL_INTERVAL_KEY, String(ms));
  };

  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    localStorage.setItem(TIMEFRAME_KEY, tf);
  };

  const {
    data: lbData,
    loading: lbLoading,
    refreshing: lbRefreshing,
    error: lbError,
  } = useDashboardQuery<Pick<DashboardData, 'kpi' | 'pipelines' | 'pipelineCatalog' | 'orchestrators'>>(
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

  if (lbError?.type === 'no-provider' && !lbData) {
    return <NoProviderMessage />;
  }

  return (
    <OverviewContent
      isPublic={false}
      kpi={lbData?.kpi ?? null}
      pipelines={lbData?.pipelines ?? []}
      pipelineCatalog={lbData?.pipelineCatalog ?? []}
      orchestrators={lbData?.orchestrators ?? []}
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
