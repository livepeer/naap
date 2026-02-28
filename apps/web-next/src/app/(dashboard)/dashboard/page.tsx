'use client';

/**
 * Dashboard Overview Page
 *
 * Network status overview showing key metrics, performance, costs, and live activity.
 * Designed as a single-page command center for the Livepeer network.
 *
 * All data is fetched from a provider plugin via a single GraphQL query
 * over the event bus. The dashboard has ZERO hardcoded data — it only
 * describes what it needs (the query) and renders what it receives.
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import { useJobFeedStream } from '@/hooks/useJobFeedStream';
import type {
  DashboardData,
  DashboardKPI,
  DashboardProtocol,
  DashboardFeesInfo,
  DashboardPipelineUsage,
  DashboardGPUCapacity,
  DashboardPipelinePricing,
  JobFeedEntry,
} from '@naap/plugin-sdk'; // type-only import — erased at compile time
import {
  Activity,
  CheckCircle2,
  Server,
  Clock,
  Radio,
  Layers,
  Coins,
  Cpu,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  AlertCircle,
  Loader2,
  Timer,
} from 'lucide-react';

// ============================================================================
// GraphQL Query — the ONLY place data requirements are declared
// ============================================================================

const NETWORK_OVERVIEW_QUERY = /* GraphQL */ `
  query NetworkOverview {
    kpi(window: "1h") {
      successRate { value delta }
      orchestratorsOnline { value delta }
      dailyUsageMins { value delta }
      dailyStreamCount { value delta }
    }
    protocol {
      currentRound
      blockProgress
      totalBlocks
      totalStakedLPT
    }
    fees(days: 7) {
      totalEth
      entries { day eth }
    }
    pipelines(limit: 5) {
      name mins color
    }
    gpuCapacity {
      totalGPUs
      availableCapacity
    }
    pricing {
      pipeline unit price outputPerDollar
    }
  }
`;

// ============================================================================
// Utility Components
// ============================================================================

function DeltaBadge({ value, unit = '%', invert = false }: { value: number; unit?: string; invert?: boolean }) {
  const isPositive = invert ? value < 0 : value >= 0;
  const isNeutral = value === 0;
  const color = isNeutral
    ? 'text-muted-foreground bg-muted'
    : isPositive
      ? 'text-emerald-400 bg-emerald-500/10'
      : 'text-red-400 bg-red-500/10';
  const Icon = isNeutral ? Minus : value >= 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {value >= 0 ? '+' : ''}{value}{unit}
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ============================================================================
// Skeleton & Fallback Components
// ============================================================================

function WidgetSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`p-4 rounded-lg bg-card border border-border animate-pulse ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-muted" />
        <div className="w-24 h-3 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="w-28 h-7 rounded bg-muted" />
        <div className="w-16 h-3 rounded bg-muted" />
      </div>
    </div>
  );
}

function WidgetUnavailable({ label }: { label: string }) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
        <AlertCircle className="w-4 h-4 mb-1.5 opacity-40" />
        <span className="text-[11px]">{label} unavailable</span>
      </div>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-5 max-w-[1440px] mx-auto">
      <div className="flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        <span className="text-sm text-muted-foreground">Loading dashboard data...</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton />
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton />
      </div>
    </div>
  );
}

function NoProviderMessage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <AlertCircle className="w-8 h-8 mb-3 opacity-50" />
      <p className="text-sm font-medium">No dashboard data provider installed</p>
      <p className="text-xs mt-1 opacity-70">Install a dashboard provider plugin to see network data</p>
    </div>
  );
}

// ============================================================================
// Row 1: Key Performance Indicators
// ============================================================================

function KPICard({
  icon: Icon,
  iconColor,
  label,
  value,
  delta,
  deltaUnit,
  deltaInvert,
  suffix,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string | number;
  delta: number;
  deltaUnit?: string;
  deltaInvert?: boolean;
  suffix?: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border hover:border-border/80 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1 rounded-md ${iconColor}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-foreground tracking-tight font-mono">{value}</span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
        <DeltaBadge value={delta} unit={deltaUnit} invert={deltaInvert} />
      </div>
    </div>
  );
}

function KPIRow({ data }: { data: DashboardKPI }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      <KPICard
        icon={CheckCircle2}
        iconColor="bg-muted text-muted-foreground"
        label="Success Rate (1h)"
        value={`${data.successRate.value}%`}
        delta={data.successRate.delta}
        deltaUnit="% vs prev hr"
      />
      <KPICard
        icon={Server}
        iconColor="bg-muted text-muted-foreground"
        label="Orchestrators Online"
        value={data.orchestratorsOnline.value}
        delta={data.orchestratorsOnline.delta}
        deltaUnit=""
      />
      <KPICard
        icon={Clock}
        iconColor="bg-muted text-muted-foreground"
        label="Daily Usage"
        value={formatNumber(data.dailyUsageMins.value)}
        delta={data.dailyUsageMins.delta}
        deltaUnit=" mins"
        suffix="mins"
      />
      <KPICard
        icon={Radio}
        iconColor="bg-muted text-muted-foreground"
        label="Daily Streams"
        value={data.dailyStreamCount.value.toLocaleString()}
        delta={data.dailyStreamCount.delta}
        deltaUnit=""
      />
    </div>
  );
}

// ============================================================================
// Row 2: Protocol, Fees, Pipelines, Capacity
// ============================================================================

function ProtocolCard({ data }: { data: DashboardProtocol }) {
  const progressPct = data.totalBlocks > 0
    ? Math.round((data.blockProgress / data.totalBlocks) * 100)
    : 0;

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Layers className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Protocol</span>
      </div>
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold text-foreground font-mono">Round {data.currentRound.toLocaleString()}</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Block Progress</span>
              <span>{progressPct}% ({data.blockProgress.toLocaleString()} / {data.totalBlocks.toLocaleString()})</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Staked</span>
            <span className="text-sm font-semibold text-foreground">{formatNumber(data.totalStakedLPT)} LPT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeesCard({ data }: { data: DashboardFeesInfo }) {
  const maxFee = Math.max(...data.entries.map(d => d.eth), 1);

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground">
            <Coins className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Fees (7d)</span>
        </div>
        <span className="text-sm font-semibold font-mono text-foreground">{data.totalEth.toFixed(1)} ETH</span>
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {data.entries.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full relative">
              <div
                className="w-full bg-emerald-500 rounded-t-sm hover:bg-emerald-400 transition-colors"
                style={{ height: `${(d.eth / maxFee) * 80}px` }}
                title={`${d.eth} ETH`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelinesCard({ data }: { data: DashboardPipelineUsage[] }) {
  const maxMins = Math.max(...data.map(p => p.mins), 1);

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Activity className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Top Pipelines (Daily)</span>
      </div>
      <div className="space-y-2.5">
        {data.map((p) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 truncate" title={p.name}>{p.name}</span>
            <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(p.mins / maxMins) * 100}%`,
                  backgroundColor: p.color ?? '#8b5cf6',
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="text-xs font-mono text-foreground w-14 text-right">{formatNumber(p.mins)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GPUCapacityCard({ data }: { data: DashboardGPUCapacity }) {
  const usedPct = 100 - data.availableCapacity;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (usedPct / 100) * circumference;

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">GPU Capacity</span>
      </div>
      <div className="flex items-center gap-5">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" className="text-muted" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={radius} fill="none"
              stroke="currentColor"
              className="text-emerald-500"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-foreground">{data.availableCapacity}%</span>
            <span className="text-[9px] text-muted-foreground">Available</span>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-xl font-semibold font-mono text-foreground">{data.totalGPUs}</span>
            <span className="text-xs text-muted-foreground ml-1">GPUs</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span>Used: {usedPct}% ({Math.round(data.totalGPUs * usedPct / 100)})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-muted inline-block" />
              <span>Free: {data.availableCapacity}% ({Math.round(data.totalGPUs * data.availableCapacity / 100)})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Row 3: Live Job Feed & Pipeline Pricing
// ============================================================================

function JobFeedCard({ jobs, connected }: { jobs: JobFeedEntry[]; connected: boolean }) {
  const statusStyles: Record<string, string> = {
    running: 'bg-emerald-500/15 text-emerald-400',
    completed: 'bg-blue-500/10 text-blue-400',
    failed: 'bg-red-500/15 text-red-400',
  };

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-emerald-400">
            <Zap className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Live Job Feed</span>
        </div>
        {connected && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
          </div>
        )}
      </div>
      <div className="overflow-hidden">
        {jobs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            {connected ? 'Waiting for jobs...' : 'Job feed not connected'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left pb-2 font-medium">Job ID</th>
                <th className="text-left pb-2 font-medium">Time</th>
                <th className="text-left pb-2 font-medium">Pipeline</th>
                <th className="text-right pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, i) => (
                <tr
                  key={job.id}
                  className={`border-b border-border/50 last:border-0 transition-colors ${i === 0 ? 'animate-pulse-once' : ''}`}
                >
                  <td className="py-2 font-mono text-foreground">{job.id}</td>
                  <td className="py-2 text-muted-foreground">{formatTime(job.startedAt)}</td>
                  <td className="py-2 text-foreground">{job.pipeline}</td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[job.status] ?? ''}`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PricingCard({ data }: { data: DashboardPipelinePricing[] }) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Coins className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Pipeline Unit Cost</span>
      </div>
      <div className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left pb-2 font-medium">Pipeline</th>
              <th className="text-left pb-2 font-medium">Unit</th>
              <th className="text-right pb-2 font-medium">Price</th>
              <th className="text-right pb-2 font-medium">Output / $1</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.pipeline} className="border-b border-border/50 last:border-0">
                <td className="py-2 text-foreground font-medium">{p.pipeline}</td>
                <td className="py-2 text-muted-foreground">per {p.unit}</td>
                <td className="py-2 text-right font-mono text-foreground">${p.price}</td>
                <td className="py-2 text-right text-emerald-400 font-medium">{p.outputPerDollar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Polling Interval Selector
// ============================================================================

const POLL_INTERVAL_KEY = 'naap_dashboard_poll_interval';
const DEFAULT_POLL_INTERVAL = 15_000;

const POLL_OPTIONS = [
  { label: '5s',  value: 5_000  },
  { label: '15s', value: 15_000 },
  { label: '30s', value: 30_000 },
  { label: '90s', value: 90_000 },
] as const;

function getStoredPollInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_POLL_INTERVAL;
  const stored = localStorage.getItem(POLL_INTERVAL_KEY);
  if (!stored) return DEFAULT_POLL_INTERVAL;
  const parsed = Number(stored);
  return POLL_OPTIONS.some((o) => o.value === parsed) ? parsed : DEFAULT_POLL_INTERVAL;
}

function PollIntervalSelector({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
      <Timer className="w-3 h-3 text-muted-foreground ml-1" />
      {POLL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors duration-100 ${
            value === opt.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================

export default function DashboardPage() {
  useAuth();

  const [pollInterval, setPollInterval] = useState(getStoredPollInterval);

  const handlePollIntervalChange = (ms: number) => {
    setPollInterval(ms);
    localStorage.setItem(POLL_INTERVAL_KEY, String(ms));
  };

  const { data, loading, error } = useDashboardQuery<DashboardData>(
    NETWORK_OVERVIEW_QUERY,
    undefined,
    { pollInterval, timeout: 8000 }
  );

  const { jobs, connected: jobFeedConnected } = useJobFeedStream({ maxItems: 8 });

  // Loading state
  if (loading && !data) {
    return <DashboardLoading />;
  }

  // No provider installed
  if (error?.type === 'no-provider') {
    return (
      <div className="space-y-5 max-w-[1440px] mx-auto">
        <DashboardHeader pollInterval={pollInterval} onPollIntervalChange={handlePollIntervalChange} />
        <NoProviderMessage />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto">
      <DashboardHeader pollInterval={pollInterval} onPollIntervalChange={handlePollIntervalChange} />

      {/* Row 1: Key Performance Indicators */}
      {data?.kpi ? (
        <KPIRow data={data.kpi} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <WidgetUnavailable label="KPI" />
        </div>
      )}

      {/* Row 2: Protocol, Fees, Pipelines, GPU */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {data?.protocol ? <ProtocolCard data={data.protocol} /> : <WidgetUnavailable label="Protocol" />}
        {data?.fees ? <FeesCard data={data.fees} /> : <WidgetUnavailable label="Fees" />}
        {data?.pipelines ? <PipelinesCard data={data.pipelines} /> : <WidgetUnavailable label="Pipelines" />}
        {data?.gpuCapacity ? <GPUCapacityCard data={data.gpuCapacity} /> : <WidgetUnavailable label="GPU Capacity" />}
      </div>

      {/* Row 3: Live Feed & Pricing */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
        <JobFeedCard jobs={jobs} connected={jobFeedConnected} />
        {data?.pricing ? <PricingCard data={data.pricing} /> : <WidgetUnavailable label="Pricing" />}
      </div>
    </div>
  );
}

function DashboardHeader({
  pollInterval,
  onPollIntervalChange,
}: {
  pollInterval: number;
  onPollIntervalChange: (ms: number) => void;
}) {
  return (
    <div className="flex items-end justify-between">
      <div className="space-y-0.5">
        <h1 className="text-lg font-semibold text-foreground">Network Overview</h1>
        <p className="text-[13px] text-muted-foreground">
          Livepeer network health, performance, and cost at a glance
        </p>
      </div>
      <div className="flex items-center gap-2">
        <PollIntervalSelector value={pollInterval} onChange={onPollIntervalChange} />
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-medium text-muted-foreground">Online</span>
        </div>
      </div>
    </div>
  );
}
