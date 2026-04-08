'use client';

import { useEffect, useState } from 'react';
import { PublicTopBar } from '@/components/layout/public-top-bar';
import { OverviewContent } from '@/components/dashboard/overview-content';
import { usePublicDashboard } from '@/hooks/usePublicDashboard';

const POLL_INTERVAL_KEY = 'naap_dashboard_poll_interval';
const TIMEFRAME_KEY = 'naap_dashboard_timeframe';
const DEFAULT_POLL_INTERVAL = 15_000;
const DEFAULT_TIMEFRAME = '12';

export default function PublicOverviewPage() {
  const [jobFeedPollInterval, setJobFeedPollInterval] = useState(DEFAULT_POLL_INTERVAL);
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    const storedPoll = localStorage.getItem(POLL_INTERVAL_KEY);
    if (storedPoll) {
      const parsed = Number(storedPoll);
      if ([5_000, 15_000, 30_000, 90_000].includes(parsed)) setJobFeedPollInterval(parsed);
    }
    const storedTf = localStorage.getItem(TIMEFRAME_KEY);
    if (storedTf && ['1', '6', '12', '18', '24'].includes(storedTf)) setTimeframe(storedTf);
    setPrefsReady(true);
  }, []);

  const {
    data,
    lbLoading,
    rtLoading,
    feesLoading,
    jobFeedLoading,
    lbRefreshing,
    rtRefreshing,
    feesRefreshing,
    error,
  } = usePublicDashboard({
    timeframe,
    jobFeedPollInterval,
    skip: !prefsReady,
  });

  const handleJobFeedPollIntervalChange = (ms: number) => {
    setJobFeedPollInterval(ms);
    localStorage.setItem(POLL_INTERVAL_KEY, String(ms));
  };

  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    localStorage.setItem(TIMEFRAME_KEY, tf);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <PublicTopBar />
      <main className="flex-1 p-2">
        {error && (
          <div className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Some data could not be loaded. Displayed information may be incomplete.
          </div>
        )}
        <div className="rounded-lg bg-card border border-border/60">
          <div className="px-3 py-3 sm:px-5 sm:py-4">
            <OverviewContent
              isPublic
              kpi={data.kpi}
              pipelines={data.pipelines}
              pipelineCatalog={data.pipelineCatalog}
              orchestrators={data.orchestrators}
              protocol={data.protocol}
              gpuCapacity={data.gpuCapacity}
              pricing={data.pricing}
              fees={data.fees}
              jobs={data.jobs}
              jobFeedConnected={data.jobFeedConnected}
              jobFeedPollInterval={jobFeedPollInterval}
              onJobFeedPollIntervalChange={handleJobFeedPollIntervalChange}
              jobFeedMeta={null}
              jobFeedError={null}
              jobFeedLoading={jobFeedLoading}
              timeframe={timeframe}
              onTimeframeChange={handleTimeframeChange}
              lbLoading={lbLoading}
              rtLoading={rtLoading}
              feesLoading={feesLoading}
              lbRefreshing={lbRefreshing}
              rtRefreshing={rtRefreshing}
              feesRefreshing={feesRefreshing}
              lbError={null}
              rtError={null}
              feesError={null}
              prefsReady={prefsReady}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
