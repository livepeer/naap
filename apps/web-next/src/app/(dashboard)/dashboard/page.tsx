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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import { useJobFeedStream, type JobFeedConnectionMeta } from '@/hooks/useJobFeedStream';
import type {
  DashboardData,
  DashboardKPI,
  HourlyBucket,
  DashboardProtocol,
  DashboardFeesInfo,
  DashboardPipelineUsage,
  DashboardPipelineCatalogEntry,
  DashboardGPUCapacity,
  DashboardPipelinePricing,
  DashboardOrchestrator,
  JobFeedEntry,
} from '@naap/plugin-sdk';
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
  Info,
  Loader2,
  Timer,
  List,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PIPELINE_DISPLAY } from '@/lib/dashboard/pipeline-config';
// ============================================================================
// GraphQL Query — the ONLY place data requirements are declared
// ============================================================================

const LEADERBOARD_QUERY = /* GraphQL */ `
  query LeaderboardData($timeframe: String) {
    kpi(timeframe: $timeframe) {
      successRate { value delta }
      orchestratorsOnline { value delta }
      dailyUsageMins { value delta }
      dailySessionCount { value delta }
      timeframeHours
      hourlyUsage { hour value }
      hourlySessions { hour value }
    }
    pipelines(limit: 50, timeframe: $timeframe) {
      name mins sessions avgFps color modelMins { model mins sessions avgFps }
    }
    pipelineCatalog {
      id name models regions
    }
    orchestrators(period: $timeframe) {
      address knownSessions successSessions successRatio effectiveSuccessRate noSwapRatio slaScore pipelines pipelineModels { pipelineId modelIds } gpuCount
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
      pipeline unit price pixelsPerUnit outputPerDollar
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

/**
 * Leaderboard-backed queries (KPI, pipelines, orchestrators) go through
 * upstream pagination with a configurable timeout (LEADERBOARD_PROXY_TIMEOUT_MS,
 * default 60 s). 70 s gives headroom so the client outlasts a slow upstream
 * round-trip. With 1 hr TTLs most requests are cache hits.
 */
const LEADERBOARD_QUERY_TIMEOUT_MS = 25_000;

/** ClickHouse + The Graph queries are fast; 15 s is generous. */
const REALTIME_QUERY_TIMEOUT_MS = 15_000;

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

/** Raw digits only — no locale grouping (Pipeline Unit Cost wei column). */
function formatPlainNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return String(n);
}

function formatUsdCompact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

/** Badge color classes (bg + text) for model badges — same as orchestrator table */
const MODEL_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
] as const;

function modelBadgeColor(modelId: string): (typeof MODEL_BADGE_COLORS)[number] {
  let n = 0;
  for (let i = 0; i < modelId.length; i++) n += modelId.charCodeAt(i);
  return MODEL_BADGE_COLORS[Math.abs(n) % MODEL_BADGE_COLORS.length];
}

/** Capability id shown as a gray monospace slug (same spirit as model ids under GPU breakdown). */
const LIVE_VIDEO_TO_VIDEO_PIPELINE_ID = 'live-video-to-video';

/**
 * Split stream_events `pipeline` slug into a dashboard pipeline label (from
 * PIPELINE_DISPLAY when known) and a model / variant remainder.
 */
function jobFeedPipelineParts(pipelineSlug: string): {
  pipelineLabel: string;
  modelLabel: string;
  matched: boolean;
} {
  const slug = pipelineSlug.trim();
  if (!slug) return { pipelineLabel: '—', modelLabel: '—', matched: false };

  // In stream events, these are model/constraint values for live-video-to-video.
  if (slug === 'noop' || slug.startsWith('streamdiffusion')) {
    return {
      pipelineLabel: PIPELINE_DISPLAY[LIVE_VIDEO_TO_VIDEO_PIPELINE_ID] ?? LIVE_VIDEO_TO_VIDEO_PIPELINE_ID,
      modelLabel: slug,
      matched: true,
    };
  }

  const exact = PIPELINE_DISPLAY[slug];
  if (exact != null) {
    return { pipelineLabel: exact, modelLabel: '—', matched: true };
  }

  const keys = Object.keys(PIPELINE_DISPLAY)
    .filter((k) => PIPELINE_DISPLAY[k] != null)
    .sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (slug === key) {
      return { pipelineLabel: PIPELINE_DISPLAY[key]!, modelLabel: '—', matched: true };
    }
    if (slug.startsWith(`${key}-`) || slug.startsWith(`${key}_`)) {
      const rest = slug.slice(key.length).replace(/^[-_]/, '');
      return { pipelineLabel: PIPELINE_DISPLAY[key]!, modelLabel: rest || '—', matched: true };
    }
  }

  return { pipelineLabel: slug, modelLabel: '—', matched: false };
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

/** Wraps a widget to show a subtle refreshing indicator over stale content. */
function RefreshWrap({
  refreshing,
  children,
  className = '',
}: {
  refreshing: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`.trim()}>
      {children}
      {refreshing && (
        <div className="absolute inset-0 rounded-lg bg-card/60 flex items-center justify-center pointer-events-none z-10 backdrop-blur-[1px] transition-opacity duration-200">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
      )}
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

function HourlySparkline({ data, color = 'var(--color-muted-foreground)' }: { data: HourlyBucket[]; color?: string }) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-px mt-3 h-10" title="Per UTC hour (oldest → newest); missing hours show as zero">
      {data.map((bucket, i) => {
        const pct = (bucket.value / max) * 100;
        const hourLabel = new Date(bucket.hour).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
          hour12: false,
        });
        return (
          <div
            key={bucket.hour}
            className="flex-1 min-w-0 rounded-sm transition-all hover:opacity-80 group relative"
            style={{ height: `${Math.max(pct, 4)}%`, backgroundColor: color, opacity: pct > 0 ? 1 : 0.15 }}
          >
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10 pointer-events-none">
              <div className="bg-popover text-popover-foreground text-[10px] font-mono px-1.5 py-0.5 rounded shadow-md border border-border whitespace-nowrap">
                {hourLabel}: {bucket.value.toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KPICard({
  icon: Icon,
  iconColor,
  label,
  value,
  delta,
  deltaUnit,
  deltaInvert,
  suffix,
  action,
  tooltip,
  sparkline,
  sparklineColor,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string | number;
  delta: number;
  deltaUnit?: string;
  deltaInvert?: boolean;
  suffix?: string;
  action?: React.ReactNode;
  tooltip?: string;
  sparkline?: HourlyBucket[];
  sparklineColor?: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border hover:border-border/80 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1 rounded-md ${iconColor}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {tooltip && (
          <div className="relative group">
            <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-20 pointer-events-none">
              <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-md border border-border whitespace-nowrap max-w-[220px] text-wrap leading-relaxed">
                {tooltip}
              </div>
            </div>
          </div>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-foreground tracking-tight font-mono">{value}</span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
        {/* DeltaBadge removed as we don't have the data for it right now */}
      </div>
      <HourlySparkline data={sparkline ?? []} color={sparklineColor} />
    </div>
  );
}

function formatTimeframeLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`;
  if (hours === 1) return '1h';
  return `${hours}h`;
}

function KPIRow({ data }: { data: DashboardKPI }) {
  const tfLabel = formatTimeframeLabel(data.timeframeHours);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      <KPICard
        icon={CheckCircle2}
        iconColor="bg-muted text-muted-foreground"
        label={`Success Rate (${tfLabel})`}
        value={`${data.successRate.value}%`}
        delta={data.successRate.delta}
        deltaUnit="% vs prev"
      />
      <KPICard
        icon={Server}
        iconColor="bg-muted text-muted-foreground"
        label={`Orchestrators (${tfLabel})`}
        value={data.orchestratorsOnline.value}
        delta={data.orchestratorsOnline.delta}
        deltaUnit=""
      />
      <KPICard
        icon={Clock}
        iconColor="bg-muted text-muted-foreground"
        label={`Usage (${tfLabel})`}
        value={formatNumber(data.dailyUsageMins.value)}
        delta={data.dailyUsageMins.delta}
        deltaUnit=" mins"
        suffix="mins"
        tooltip="Total transcoding minutes across all pipelines. Sparkline: one bar per UTC hour (full window; gaps in upstream data appear as zero)."
        sparkline={data.hourlyUsage}
        sparklineColor="hsl(var(--primary))"
      />
      <KPICard
        icon={Radio}
        iconColor="bg-muted text-muted-foreground"
        label={`Sessions (${tfLabel})`}
        value={data.dailySessionCount.value.toLocaleString()}
        delta={data.dailySessionCount.delta}
        deltaUnit=""
        tooltip="Served + unserved demand sessions (job starts per hour). Sparkline: one bar per UTC hour (full window; gaps in upstream data appear as zero)."
        sparkline={data.hourlySessions}
        sparklineColor="hsl(var(--primary))"
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
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Layers className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Protocol</span>
      </div>
      <div className="space-y-4 flex-1 min-h-0">
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
  const [grouping, setGrouping] = useState<'day' | 'week'>('week');
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  const chartData = useMemo(
    () =>
      grouping === 'day'
        ? data.dayData.map((d) => ({ x: d.dateS, y: d.volumeUsd }))
        : data.weeklyData.map((w) => ({ x: w.date, y: w.weeklyVolumeUsd })),
    [data.dayData, data.weeklyData, grouping]
  );

  const baseValue = grouping === 'day' ? data.oneDayVolumeUsd : data.oneWeekVolumeUsd;
  const pctChange = grouping === 'day' ? data.volumeChangeUsd : data.weeklyVolumeChangeUsd;
  const displayValue = hovered?.y ?? baseValue;
  const displayDate = hovered
    ? new Date(hovered.x * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const rawRows = useMemo(() => {
    const rows =
      grouping === 'day'
        ? data.dayData.map((d) => ({
            ts: d.dateS,
            volumeUsd: d.volumeUsd,
            volumeEth: d.volumeEth,
          }))
        : data.weeklyData.map((w) => ({
            ts: w.date,
            volumeUsd: w.weeklyVolumeUsd,
            volumeEth: w.weeklyVolumeEth,
          }));
    return [...rows].sort((a, b) => b.ts - a.ts);
  }, [data.dayData, data.weeklyData, grouping]);

  return (
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col">
      <div className="flex items-start justify-between mb-3 shrink-0">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-muted text-muted-foreground">
              <Coins className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Fees Paid</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-foreground font-mono">{formatUsd(displayValue)}</span>
            {!hovered ? <DeltaBadge value={pctChange} unit="%" /> : null}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {displayDate ?? (grouping === 'day' ? 'Latest day' : 'Latest full week')} • Total {formatUsdCompact(data.totalUsd)} ({data.totalEth.toFixed(2)} ETH)
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRawOpen((v) => !v)}
            className={`p-1 rounded transition-colors ${
              rawOpen
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            }`}
            title={rawOpen ? 'Hide raw fees data' : 'View raw fees data'}
            aria-label={rawOpen ? 'Hide raw fees data' : 'View raw fees data'}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
            <button
              onClick={() => setGrouping('day')}
              aria-label="Show daily fees"
              aria-pressed={grouping === 'day'}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                grouping === 'day' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              D
            </button>
            <button
              onClick={() => setGrouping('week')}
              aria-label="Show weekly fees"
              aria-pressed={grouping === 'week'}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                grouping === 'week' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              W
            </button>
          </div>
        </div>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            onMouseMove={(e) => {
              const point = e?.activePayload?.[0]?.payload;
              if (point) {
                setHovered({ x: Number(point.x), y: Number(point.y) });
              } else {
                setHovered(null);
              }
            }}
            onMouseLeave={() => setHovered(null)}
          >
            <XAxis
              dataKey="x"
              tickLine={false}
              axisLine={false}
              minTickGap={18}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(x) =>
                new Date(Number(x) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }
            />
            <YAxis
              width={40}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => formatUsdCompact(Number(v))}
            />
            <Tooltip cursor={{ fill: 'rgba(34, 197, 94, 0.08)' }} content={() => null} />
            <Bar dataKey="y" radius={[4, 4, 0, 0]} fill="hsl(142 71% 45%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rawOpen && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">
            Raw {grouping === 'day' ? 'Daily' : 'Weekly'} Fees Data ({rawRows.length} rows)
          </div>
          <div className="max-h-44 overflow-auto rounded border border-border/70">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left px-2.5 py-1.5 font-medium">Date</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Volume (USD)</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Volume (ETH)</th>
                </tr>
              </thead>
              <tbody>
                {rawRows.map((row) => (
                  <tr key={`${grouping}-${row.ts}`} className="border-b border-border/40 last:border-0">
                    <td className="px-2.5 py-1.5 text-foreground font-mono">
                      {new Date(row.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-foreground font-mono">{formatUsd(row.volumeUsd)}</td>
                    <td className="px-2.5 py-1.5 text-right text-muted-foreground font-mono">{row.volumeEth.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


function PipelinesCard({
  data,
  catalog,
  timeframeHours,
}: {
  data: DashboardPipelineUsage[];
  catalog?: DashboardPipelineCatalogEntry[] | null;
  timeframeHours: number;
}) {
  const mergedPipelines = useMemo(() => {
    const usageByName = new Map(data.filter((p) => p.name?.trim()).map((p) => [p.name, p]));
    const result: Array<DashboardPipelineUsage & { models?: string[] }> = [];

    for (const p of data.filter((p) => p.name?.trim())) {
      const catalogEntry = catalog?.find((c) => c.name === p.name || c.id === p.name);
      result.push({
        ...p,
        models: catalogEntry?.models,
      });
    }

    if (catalog) {
      for (const c of catalog) {
        if (!usageByName.has(c.name) && !usageByName.has(c.id)) {
          result.push({
            name: c.name,
            mins: 0,
            sessions: 0,
            avgFps: 0,
            color: '#6366f1',
            models: c.models,
          });
        }
      }
    }

    return result;
  }, [data, catalog]);

  const activePipelines = mergedPipelines.filter((p) => p.mins > 0);
  const availablePipelines = mergedPipelines.filter((p) => p.mins === 0);
  const [availableExpanded, setAvailableExpanded] = useState(false);

  return (
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Activity className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Pipelines ({formatTimeframeLabel(timeframeHours).toUpperCase()})
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-between gap-3">
        <table className="w-full text-xs shrink-0">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
              <th className="pb-2 font-medium text-left">Pipeline</th>
              <th className="pb-2 font-medium text-right">Mins</th>
              <th className="pb-2 font-medium text-right">FPS</th>
            </tr>
          </thead>
          <tbody>
            {activePipelines.map((p) => (
              <tr key={p.name} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: p.color ?? '#8b5cf6', opacity: 0.9 }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-foreground truncate" title={p.name}>
                      {p.name}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 text-right font-mono text-foreground">
                  {formatNumber(p.mins)}
                </td>
                <td className="py-1.5 text-right font-mono text-foreground">
                  {(p.avgFps ?? 0) > 0 ? p.avgFps : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {availablePipelines.length > 0 ? (
          <div className="shrink-0 pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => setAvailableExpanded((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-muted-foreground transition-colors group"
              aria-expanded={availableExpanded}
            >
              <span>Available (no demand in {formatTimeframeLabel(timeframeHours)})</span>
              <span className="transition-transform group-hover:opacity-100">
                {availableExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </span>
            </button>
            {availableExpanded && (
              <table className="w-full text-xs mt-1.5">
                <tbody>
                  {availablePipelines.map((p) => (
                    <tr key={p.name} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: p.color ?? '#6366f1', opacity: 0.5 }}
                            aria-hidden="true"
                          />
                          <span
                            className={
                              p.name === LIVE_VIDEO_TO_VIDEO_PIPELINE_ID
                                ? 'font-mono text-muted-foreground truncate'
                                : 'font-medium text-muted-foreground truncate'
                            }
                            title={p.name}
                          >
                            {p.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground/50">0</td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground/50">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GPUCapacityCard({ data, timeframeHours }: { data: DashboardGPUCapacity; timeframeHours: number }) {
  const [pipelinesExpanded, setPipelinesExpanded] = useState(true);

  return (
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Network GPUs ({formatTimeframeLabel(timeframeHours)})
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold font-mono text-foreground">{data.totalGPUs}</span>
        <span className="text-sm text-muted-foreground">total GPUs</span>
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground mb-4">
        <span className="text-emerald-400">{data.activeGPUs} active</span>
        <span className="text-muted-foreground/60">{data.totalGPUs - data.activeGPUs} idle</span>
      </div>

      {data.pipelineGPUs && data.pipelineGPUs.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPipelinesExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-muted-foreground transition-colors group mb-2"
            aria-expanded={pipelinesExpanded}
          >
            <span>By Pipeline</span>
            <span className="transition-transform group-hover:opacity-100">
              {pipelinesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </span>
          </button>
          {pipelinesExpanded && (
            <div className="space-y-2">
              {data.pipelineGPUs.map((p) => (
                <div key={p.name} className="rounded border border-border/60 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-muted/20">
                    <div
                      className={
                        p.name === LIVE_VIDEO_TO_VIDEO_PIPELINE_ID
                          ? 'text-xs font-mono text-muted-foreground truncate'
                          : 'text-xs font-medium text-foreground truncate'
                      }
                      title={p.name}
                    >
                      {p.name}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                      {formatNumber(p.gpus)} GPUs
                    </span>
                  </div>
                  {p.models && p.models.length > 0 && (
                    <div className="px-2 py-1 space-y-0.5 border-t border-border/40">
                      {p.models.map((m) => (
                        <div key={m.model} className="flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground pr-2 font-mono break-all">{m.model}</span>
                          <span className="font-mono text-foreground flex-shrink-0">{formatNumber(m.gpus)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Live Job Feed & Pipeline Unit Cost cards
// ============================================================================

type JobFeedSortCol = 'model' | 'outputFps' | 'durationSeconds' | 'status';

function JobFeedCard({
  jobs,
  connected,
  pollInterval,
  onPollIntervalChange,
  feedMeta,
}: {
  jobs: JobFeedEntry[];
  connected: boolean;
  pollInterval: number;
  onPollIntervalChange: (ms: number) => void;
  feedMeta: JobFeedConnectionMeta | null;
}) {
  const [sortCol, setSortCol] = useState<JobFeedSortCol>('durationSeconds');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (col: JobFeedSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      const { modelLabel: am } = jobFeedPipelineParts(a.pipeline);
      const { modelLabel: bm } = jobFeedPipelineParts(b.pipeline);
      switch (sortCol) {
        case 'model': av = am === '—' ? '' : am; bv = bm === '—' ? '' : bm; break;
        case 'outputFps': av = a.outputFps ?? 0; bv = b.outputFps ?? 0; break;
        case 'durationSeconds': av = a.durationSeconds ?? 0; bv = b.durationSeconds ?? 0; break;
        case 'status': av = a.status; bv = b.status; break;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [jobs, sortCol, sortDir]);

  const SortIcon = ({ col }: { col: JobFeedSortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3" />;
  };

  const TH = ({ col, label, right }: { col: JobFeedSortCol; label: string; right?: boolean }) => (
    <th className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <SortIcon col={col} />
      </button>
    </th>
  );

  const statusStyles: Record<string, string> = {
    online: 'bg-emerald-500/15 text-emerald-400',
    running: 'bg-emerald-500/15 text-emerald-400',
    degraded_input: 'bg-amber-500/15 text-amber-400',
    degraded_inference: 'bg-amber-500/15 text-amber-400',
    degraded_output: 'bg-amber-500/15 text-amber-400',
    degraded: 'bg-amber-500/15 text-amber-400',
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
        <div className="flex items-center gap-2">
          <JobFeedPollIntervalSelector value={pollInterval} onChange={onPollIntervalChange} />
          {connected && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-2">
            <Radio className="w-5 h-5 text-muted-foreground/30 mb-2" />
            <span className="text-xs text-muted-foreground">
              {feedMeta?.fetchFailed
                ? 'Could not load the job feed. Check the network or try again.'
                : feedMeta && !feedMeta.clickhouseConfigured
                  ? 'Live job feed needs ClickHouse (set CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD on the server).'
                  : feedMeta?.queryFailed
                    ? 'ClickHouse query failed. See server logs for details.'
                    : 'No active streams'}
            </span>
            {feedMeta && !feedMeta.fetchFailed && !feedMeta.queryFailed && feedMeta.clickhouseConfigured ? (
              <span className="text-[10px] text-muted-foreground/70 mt-2 max-w-sm">
                Streams with events in the last 3 minutes are shown. If you expect rows, confirm{' '}
                <code className="text-[10px]">semantic.stream_events</code> exists and optionally set{' '}
                <code className="text-[10px]">JOB_FEED_PIPELINE_FILTER</code> to match your pipeline names.
              </span>
            ) : null}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10 text-[10px] text-muted-foreground uppercase tracking-wider">
              <tr className="border-b border-border">
                <TH col="model" label="Model" />
                <TH col="outputFps" label="FPS" right />
                <TH col="durationSeconds" label="Running" right />
                <TH col="status" label="State" right />
              </tr>
            </thead>
            <tbody>
              {sorted.map((job) => {
                const { pipelineLabel, modelLabel } = jobFeedPipelineParts(job.pipeline);
                const rowTooltip = [
                  `Stream: ${job.id}`,
                  `Pipeline: ${pipelineLabel}`,
                  modelLabel !== '—' ? `Model: ${modelLabel}` : null,
                  job.gateway ? `Gateway: ${job.gateway}` : null,
                  job.orchestratorUrl ? `Orchestrator: ${job.orchestratorUrl}` : null,
                  job.startedAt ? `First seen: ${job.startedAt}` : null,
                  job.lastSeen ? `Last seen: ${job.lastSeen}` : null,
                  job.durationSeconds != null ? `Duration: ${job.durationSeconds}s` : null,
                  job.inputFps != null ? `Input FPS: ${job.inputFps}` : null,
                  job.outputFps != null ? `Output FPS: ${job.outputFps}` : null,
                  `Status: ${job.status}`,
                ].filter(Boolean).join('\n');
                return (
                <tr
                  key={job.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-default"
                  title={rowTooltip}
                >
                  <td className="py-2">
                    {modelLabel !== '—' ? (
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium font-mono max-w-[200px] truncate ${modelBadgeColor(modelLabel)}`}
                        title={pipelineLabel}
                      >
                        {modelLabel}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-foreground">
                    {job.inputFps != null && job.outputFps != null
                      ? `${job.inputFps} / ${job.outputFps}`
                      : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-muted-foreground">
                    {job.runningFor ?? '—'}
                  </td>
                  <td className="py-2 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[job.status] ?? ''}`}>
                      {job.status}
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PricingCard({ data }: { data: DashboardPipelinePricing[] }) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Coins className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Pipeline Unit Cost</span>
      </div>
      <div className="overflow-hidden">
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No capability pricing in the sampled window (configure ClickHouse env or check data).
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left pb-2 font-medium">Model</th>
                <th className="text-right pb-2 font-medium">
                  <div>Avg price (wei)</div>
                  <div className="text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80 max-w-[140px] ml-auto">
                    wei / unit of pixels
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => {
                const pxUnit = p.pixelsPerUnit != null && p.pixelsPerUnit > 0 ? p.pixelsPerUnit : null;
                const perPixel = pxUnit != null && p.price > 0 ? p.price / pxUnit : null;
                const pixelLabel =
                  pxUnit != null && Number.isFinite(pxUnit)
                    ? pxUnit === 1
                      ? 'pixel'
                      : 'pixels'
                    : null;
                const pipelineId = p.unit;
                const pipelineLabel = PIPELINE_DISPLAY[pipelineId] ?? pipelineId;
                return (
                  <tr key={`${p.pipeline}:${p.unit}`} className="border-b border-border/50 last:border-0">
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium font-mono break-all max-w-[200px] ${modelBadgeColor(p.pipeline)}`}
                        title={pipelineLabel}
                      >
                        {p.pipeline}
                      </span>
                    </td>
                    <td className="py-2 text-right align-top">
                      <div className="font-mono text-foreground">
                        {formatPlainNumber(p.price)}{' '}
                        <span className="text-[10px] text-muted-foreground font-sans">wei</span>
                      </div>
                      {perPixel != null && Number.isFinite(perPixel) && pxUnit != null && pixelLabel ? (
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {formatPlainNumber(perPixel)} wei / {formatPlainNumber(pxUnit)} {pixelLabel}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Orchestrator Table Card
// ============================================================================

type OrchestratorSortCol = 'address' | 'knownSessions' | 'successRatio' | 'effectiveSuccessRate' | 'slaScore' | 'gpuCount';
type SortDir = 'asc' | 'desc';

/** Format pipeline + models for display: "Display name (model1, model2)" using the models this orchestrator offers. */
function formatPipelineLabel(
  pipelineId: string,
  catalog: DashboardPipelineCatalogEntry[] | null | undefined,
  modelIds?: string[] | null
): string {
  const entry = catalog?.find((p) => p.id === pipelineId);
  const name = entry?.name ?? pipelineId;
  if (modelIds?.length) return `${name} (${modelIds.join(', ')})`;
  return name;
}

function OrchestratorTableCard({
  data,
  catalog,
}: {
  data: DashboardOrchestrator[];
  catalog?: DashboardPipelineCatalogEntry[] | null;
}) {
  const [sortCol, setSortCol] = useState<OrchestratorSortCol>('knownSessions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');

  const toggleSort = (col: OrchestratorSortCol) => {
    if (sortCol === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: OrchestratorSortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3" />;
  };

  const sorted = useMemo(() => {
    let rows = [...data];
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter((r) => {
        if (r.address.toLowerCase().includes(q)) return true;
        return r.pipelines.some((p) => {
          const offer = r.pipelineModels?.find((o) => o.pipelineId === p);
          const label = formatPipelineLabel(p, catalog, offer?.modelIds);
          return label.toLowerCase().includes(q) || p.toLowerCase().includes(q);
        });
      });
    }
    rows.sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [data, sortCol, sortDir, filter, catalog]);

  const ariaSortValue = (col: OrchestratorSortCol): 'ascending' | 'descending' | 'none' =>
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const TH = ({
    col,
    label,
    right,
    className = '',
  }: {
    col: OrchestratorSortCol;
    label: string;
    right?: boolean;
    className?: string;
  }) => (
    <th
      className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`.trim()}
      aria-sort={ariaSortValue(col)}
    >
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <SortIcon col={col} />
      </button>
    </th>
  );

  const totalGPUsInList = useMemo(() => sorted.reduce((sum, r) => sum + (r.gpuCount ?? 0), 0), [sorted]);

  return (
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground">
            <Server className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Orchestrators ({sorted.length}{filter ? ` of ${data.length}` : ''}) · {totalGPUsInList} GPUs
          </span>
        </div>
        <input
          id="orchestrator-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter address / pipeline…"
          aria-label="Filter orchestrators by address or pipeline"
          className="px-2 py-0.5 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground w-48"
        />
      </div>

      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground border-b border-border">
            <tr>
              <TH col="address" label="Address" />
              <TH col="knownSessions" label="Sessions" right />
              <TH col="successRatio" label="Startup %" right />
              <TH col="effectiveSuccessRate" label="Effective %" right />
              <TH col="slaScore" label="SLA" right />
              <TH col="gpuCount" label="GPUs" right className="pr-5" />
              <th className="pb-2 pl-2 font-medium text-left">Models</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.address} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                <td className="py-1.5 font-mono text-foreground">{row.address.slice(0, 8)}…{row.address.slice(-4)}</td>
                <td className="py-1.5 text-right font-mono">{row.knownSessions.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono">{row.successRatio}%</td>
                <td className="py-1.5 text-right font-mono">{row.effectiveSuccessRate != null ? `${row.effectiveSuccessRate}%` : '—'}</td>
                <td className="py-1.5 text-right font-mono">{row.slaScore ?? '—'}</td>
                <td className="py-1.5 pr-5 text-right font-mono">{row.gpuCount}</td>
                <td className="py-1.5 pl-2 max-w-[280px]">
                  <div className="flex flex-wrap gap-1">
                    {row.pipelines.length === 0 && '—'}
                    {row.pipelines.map((p) => {
                      const offer = row.pipelineModels?.find((o) => o.pipelineId === p);
                      const modelIds = offer?.modelIds ?? [];
                      const entry = catalog?.find((c) => c.id === p);
                      const pipelineName = entry?.name ?? p;
                      return modelIds.length > 0 ? (
                        modelIds.map((modelId) => (
                          <span
                            key={`${p}:${modelId}`}
                            className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${modelBadgeColor(modelId)}`}
                            title={pipelineName}
                          >
                            {modelId}
                          </span>
                        ))
                      ) : (
                        <span
                          key={p}
                          className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
                          title={pipelineName}
                        >
                          —
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-foreground">
                  {filter ? 'No orchestrators match the filter' : 'No orchestrator data'}
                </td>
              </tr>
            )}
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

/** Fixed poll interval for overview/fees — not useful to refresh more often. */

const JOB_FEED_POLL_OPTIONS = [
  { label: '5s',  value: 5_000  },
  { label: '15s', value: 15_000 },
  { label: '30s', value: 30_000 },
  { label: '90s', value: 90_000 },
] as const;

function getStoredJobFeedPollInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_POLL_INTERVAL;
  const stored = localStorage.getItem(POLL_INTERVAL_KEY);
  if (!stored) return DEFAULT_POLL_INTERVAL;
  const parsed = Number(stored);
  return JOB_FEED_POLL_OPTIONS.some((o) => o.value === parsed) ? parsed : DEFAULT_POLL_INTERVAL;
}

function JobFeedPollIntervalSelector({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
      <Timer className="w-3 h-3 text-muted-foreground ml-1" />
      {JOB_FEED_POLL_OPTIONS.map((opt) => (
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
// Timeframe Selector
// ============================================================================

const TIMEFRAME_KEY = 'naap_dashboard_timeframe';
const DEFAULT_TIMEFRAME = '12';

const TIMEFRAME_OPTIONS = [
  { label: '1h', value: '1', description: 'Last hour' },
  { label: '6h', value: '6', description: 'Last 6 hours' },
  { label: '12h', value: '12', description: 'Last 12 hours' },
  { label: '18h', value: '18', description: 'Last 18 hours' },
  { label: '24h', value: '24', description: 'Last 24 hours (max)' },
] as const;

function getStoredTimeframe(): string {
  if (typeof window === 'undefined') return DEFAULT_TIMEFRAME;
  const stored = localStorage.getItem(TIMEFRAME_KEY);
  if (!stored) return DEFAULT_TIMEFRAME;
  return TIMEFRAME_OPTIONS.some((o) => o.value === stored) ? stored : DEFAULT_TIMEFRAME;
}

function TimeframeSelector({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected =
    TIMEFRAME_OPTIONS.find((o) => o.value === value) ??
    TIMEFRAME_OPTIONS.find((o) => o.value === DEFAULT_TIMEFRAME)!;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select timeframe"
      >
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{selected.label}</span>
        <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-40 rounded-md bg-card border border-border shadow-lg z-50"
          role="listbox"
        >
          {TIMEFRAME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-xs transition-colors first:rounded-t-md last:rounded-b-md ${
                value === opt.value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
              role="option"
              aria-selected={value === opt.value}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-[10px] opacity-70">{opt.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================

export default function DashboardPage() {
  useAuth();

  // Hydration-safe defaults: read localStorage after mount to avoid SSR overwriting user preferences.
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
    LEADERBOARD_QUERY,
    { timeframe },
    { timeout: LEADERBOARD_QUERY_TIMEOUT_MS, skip: !prefsReady }
  );

  const {
    data: rtData,
    loading: rtLoading,
    refreshing: rtRefreshing,
    error: rtError,
  } = useDashboardQuery<Pick<DashboardData, 'protocol' | 'gpuCapacity' | 'pricing'>>(
    REALTIME_QUERY,
    { timeframe },
    { timeout: REALTIME_QUERY_TIMEOUT_MS, skip: !prefsReady }
  );

  const { data: feesData, loading: feesLoading, refreshing: feesRefreshing, error: feesError } = useDashboardQuery<Pick<DashboardData, 'fees'>>(
    FEES_OVERVIEW_QUERY,
    undefined,
    { timeout: LEADERBOARD_QUERY_TIMEOUT_MS, skip: !prefsReady }
  );

  const { jobs, connected: jobFeedConnected, feedMeta: jobFeedMeta } = useJobFeedStream({
    maxItems: 50,
    pollInterval: jobFeedPollInterval,
  });

  const transientDashboardErrors = useMemo(() => {
    return [lbError, rtError, feesError].filter(
      (e): e is NonNullable<typeof e> => e != null && e.type !== 'no-provider',
    );
  }, [lbError, rtError, feesError]);

  // No provider installed (only after retries exhausted)
  if (lbError?.type === 'no-provider' && !lbData) {
    return (
      <div className="space-y-6 max-w-[1440px] mx-auto">
        <DashboardHeader timeframe={timeframe} onTimeframeChange={handleTimeframeChange} />
        <NoProviderMessage />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      <DashboardHeader
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
      />
      {transientDashboardErrors.length > 0 && (
        <div className="space-y-1.5">
          {transientDashboardErrors.map((e, i) => (
            <div
              key={i}
              className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-3 py-1.5 rounded-md flex items-center gap-2"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Dashboard data may be stale — {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Row 1: KPI tiles (leaderboard) */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Network Metrics</h2>
        {lbData?.kpi ? (
          <RefreshWrap refreshing={lbRefreshing}>
            <KPIRow data={lbData.kpi} />
          </RefreshWrap>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {lbLoading
              ? <><WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton /></>
              : <WidgetUnavailable label="KPI" />}
          </div>
        )}
      </section>

      {/* Row 2: Protocol, Fees, Pipelines, GPU Capacity */}
      <section className="space-y-3">
        <div
          className="grid gap-3 items-stretch [&>*]:h-full [&>*]:min-h-0"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
        >
          {rtData?.protocol
            ? (
              <RefreshWrap refreshing={rtRefreshing} className="h-full min-h-0 flex flex-col">
                <ProtocolCard data={rtData.protocol} />
              </RefreshWrap>
            )
            : rtLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Protocol" />}
          {feesData?.fees
            ? (
              <RefreshWrap refreshing={feesRefreshing} className="h-full min-h-0 flex flex-col">
                <FeesCard data={feesData.fees} />
              </RefreshWrap>
            )
            : feesLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Fees" />}
          {lbData?.pipelines
            ? (
              <RefreshWrap refreshing={lbRefreshing} className="h-full min-h-0 flex flex-col">
                <PipelinesCard
                  data={lbData.pipelines}
                  catalog={lbData.pipelineCatalog}
                  timeframeHours={lbData.kpi?.timeframeHours ?? 12}
                />
              </RefreshWrap>
            )
            : lbLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Pipelines" />}
          {rtData?.gpuCapacity
            ? (
              <RefreshWrap refreshing={rtRefreshing} className="h-full min-h-0 flex flex-col">
                <GPUCapacityCard
                  data={rtData.gpuCapacity}
                  timeframeHours={lbData?.kpi?.timeframeHours ?? 12}
                />
              </RefreshWrap>
            )
            : rtLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="GPU Capacity" />}
        </div>
      </section>

      {/* Row 3: Live Job Feed & Pipeline Unit Cost */}
      <section className="space-y-3">
        <div
          className="grid gap-3 items-stretch [&>*]:h-full [&>*]:min-h-0"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}
        >
          <JobFeedCard
            jobs={jobs}
            connected={jobFeedConnected}
            pollInterval={jobFeedPollInterval}
            onPollIntervalChange={handleJobFeedPollIntervalChange}
            feedMeta={jobFeedMeta}
          />
          {rtData?.pricing != null
            ? <RefreshWrap refreshing={rtRefreshing} className="h-full"><PricingCard data={rtData.pricing} /></RefreshWrap>
            : rtLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Pricing" />}
        </div>
      </section>

      {/* Row 4: Orchestrators table (leaderboard) */}
      {lbData?.orchestrators ? (
        <section>
          <RefreshWrap refreshing={lbRefreshing}>
            <OrchestratorTableCard data={lbData.orchestrators} catalog={lbData.pipelineCatalog} />
          </RefreshWrap>
        </section>
      ) : lbLoading ? (
        <section><WidgetSkeleton className="h-40" /></section>
      ) : null}
    </div>
  );
}

function DashboardHeader({
  timeframe,
  onTimeframeChange,
}: {
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
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
        <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-medium text-muted-foreground">Online</span>
        </div>
      </div>
    </div>
  );
}
