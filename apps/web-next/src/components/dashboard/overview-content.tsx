'use client';

/**
 * OverviewContent — shared rendering for the Network Overview dashboard.
 *
 * Used by both the public landing page (/) and the authenticated
 * dashboard (/dashboard). Data fetching is handled by the parent;
 * this component is purely presentational + supplementary REST enrichment.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import type {
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
import type { DashboardError } from '@/hooks/useDashboardQuery';
import type { JobFeedConnectionMeta } from '@/hooks/useJobFeedStream';
import { useClipboardFlash } from '@/hooks/useClipboardFlash';
import {
  Activity,
  CheckCircle2,
  Server,
  Clock,
  Radio,
  Layers,
  Coins,
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
  Copy,
  Check,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { PIPELINE_DISPLAY, PIPELINE_COLOR, DEFAULT_PIPELINE_COLOR } from '@/lib/dashboard/pipeline-config';

// Recharts is only used inside FeesCard. Defer the bundle parse until the
// fees data arrives so the initial JS execution budget is not spent on charting.
type FeesBarChartProps = {
  chartData: { x: number; y: number }[];
  onMove: (hovered: { x: number; y: number } | null) => void;
  onLeave: () => void;
  accent: string;
  cursor: string;
  formatUsdCompact: (v: number) => string;
};
const FeesBarChart = dynamic(
  () =>
    import('recharts').then((mod) => {
      const { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis } = mod;
      return function FeesBarChartInner({
        chartData,
        onMove,
        onLeave,
        accent,
        cursor,
        formatUsdCompact: fmt,
      }: FeesBarChartProps) {
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              onMouseMove={(e) => {
                const point = e?.activePayload?.[0]?.payload;
                if (point) { onMove({ x: Number(point.x), y: Number(point.y) }); } else { onMove(null); }
              }}
              onMouseLeave={onLeave}
            >
              <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={18} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(x) => new Date(Number(x) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis width={40} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => fmt(Number(v))} />
              <Tooltip cursor={{ fill: cursor }} content={() => null} />
              <Bar dataKey="y" radius={[4, 4, 0, 0]} fill={accent} />
            </BarChart>
          </ResponsiveContainer>
        );
      };
    }),
  {
    ssr: false,
    loading: () => <div className="h-28 animate-pulse rounded bg-muted/30" />,
  },
);
import { LivepeerMarkIcon } from '@/components/brand/livepeer-mark-icon';
import { AuthCTABanner } from './auth-cta-banner';

// ============================================================================
// Props
// ============================================================================

export interface OverviewContentProps {
  isPublic: boolean;
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
  jobFeedPollInterval: number;
  onJobFeedPollIntervalChange: (ms: number) => void;
  jobFeedMeta: JobFeedConnectionMeta | null;
  jobFeedError: DashboardError | null;
  /** True while the first job-feed response has not finished (or full public batch is in flight). */
  jobFeedLoading: boolean;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  lbLoading: boolean;
  rtLoading: boolean;
  feesLoading: boolean;
  lbRefreshing: boolean;
  rtRefreshing: boolean;
  feesRefreshing: boolean;
  lbError: DashboardError | null;
  rtError: DashboardError | null;
  feesError: DashboardError | null;
  prefsReady: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';

// ============================================================================
// Utilities
// ============================================================================

function pipelinesRowCapacity(
  pipelineId: string,
  model: string,
  pricingRow: DashboardPipelinePricing | undefined,
  netCapacity: Record<string, number>,
  liveVideoCapacity: Record<string, number>,
): number | '—' {
  if (pipelineId === LIVE_VIDEO_PIPELINE_ID) {
    const fromDaydream = liveVideoCapacity[model];
    if (fromDaydream != null && fromDaydream >= 0) return fromDaydream;
    return '—';
  }
  const key = `${pipelineId}:${model}`;
  const fromNet = netCapacity[key];
  if (fromNet != null && fromNet >= 0) return fromNet;
  const fallback = pricingRow?.capacity;
  return fallback != null && fallback >= 0 ? fallback : '—';
}

function catalogNeedsNetCapacityFetch(
  catalog: DashboardPipelineCatalogEntry[],
  pricing: DashboardPipelinePricing[],
): boolean {
  for (const entry of catalog) {
    if (entry.id === LIVE_VIDEO_PIPELINE_ID) continue;
    for (const model of entry.models) {
      const p = pricing.find((x) => x.pipeline === entry.id && x.model === model);
      if (!p || p.capacity == null) return true;
    }
  }
  return false;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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

function formatTimeframeLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d`;
  if (hours === 1) return '1h';
  return `${hours}h`;
}

function getTimeframeRangeIso(timeframe: string): { start: string; end: string } {
  const parsed = Number.parseInt(timeframe, 10);
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

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

/** Canonical pipeline id for theming (matches Pipelines & GPUs / PIPELINE_COLOR). */
function jobFeedResolvePipelineId(pipelineSlug: string): string {
  const s = pipelineSlug.trim();
  if (!s) return '';
  if (s === 'noop' || s.startsWith('streamdiffusion')) return LIVE_VIDEO_PIPELINE_ID;
  if (PIPELINE_DISPLAY[s] != null) return s;
  const keys = Object.keys(PIPELINE_DISPLAY)
    .filter((k) => PIPELINE_DISPLAY[k] != null)
    .sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (s === key) return key;
    if (s.startsWith(`${key}-`) || s.startsWith(`${key}_`)) return key;
  }
  return s;
}

function jobFeedPipelineParts(pipelineSlug: string): {
  pipelineLabel: string;
  modelLabel: string;
  matched: boolean;
} {
  const slug = pipelineSlug.trim();
  if (!slug) return { pipelineLabel: '—', modelLabel: '—', matched: false };

  if (slug === 'noop' || slug.startsWith('streamdiffusion')) {
    return {
      pipelineLabel: PIPELINE_DISPLAY[LIVE_VIDEO_PIPELINE_ID] ?? LIVE_VIDEO_PIPELINE_ID,
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

function jobFeedRowModelLabel(job: JobFeedEntry): string {
  const m = job.model?.trim();
  if (m) return m;
  const { modelLabel } = jobFeedPipelineParts(job.pipeline);
  return modelLabel || '—';
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

function RefreshWrap({
  refreshing,
  children,
  className = '',
}: {
  refreshing: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`.trim()} aria-busy={refreshing}>
      {children}
      {refreshing && (
        <>
          <span className="sr-only" aria-live="polite">Refreshing…</span>
          <div
            className="absolute inset-0 rounded-lg bg-card/60 flex items-center justify-center pointer-events-none z-10 backdrop-blur-[1px] transition-opacity duration-200"
            aria-hidden
          >
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" aria-hidden />
          </div>
        </>
      )}
    </div>
  );
}

function DeltaBadge({ value, unit = '%', invert = false }: { value: number | null; unit?: string; invert?: boolean }) {
  if (value == null) return null;
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

// ============================================================================
// Card Components
// ============================================================================

/** KPI sparklines, fees bar, and protocol progress all use theme primary (Livepeer green). */
const OVERVIEW_CHART_ACCENT = 'hsl(var(--primary))';
const OVERVIEW_CHART_CURSOR = 'hsl(var(--primary) / 0.12)';

function HourlySparkline({ data, color = 'var(--color-muted-foreground)' }: { data: HourlyBucket[]; color?: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-px mt-3 h-10" title="Per UTC hour (oldest → newest); missing hours show as zero">
      {data.map((bucket, i) => {
        const pct = (bucket.value / max) * 100;
        const hourLabel = new Date(bucket.hour).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
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

function KPIGroupCard({ data }: { data: DashboardKPI }) {
  const tfLabel = formatTimeframeLabel(data.timeframeHours);

  const tile = (
    icon: ElementType,
    label: string,
    value: string | number,
    suffix?: string,
    sparkline?: HourlyBucket[],
    tooltip?: string,
  ) => {
    const Icon = icon;
    return (
      <div className="flex flex-col p-3 rounded-lg bg-muted/30 border border-border/50">
        <div className="flex items-center gap-1.5 mb-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          {tooltip && (
            <div className="relative group ml-auto">
              <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
              <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-20 pointer-events-none">
                <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded shadow-md border border-border max-w-[200px] text-wrap leading-relaxed">
                  {tooltip}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-foreground tracking-tight font-mono">{value}</span>
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
        <HourlySparkline data={sparkline ?? []} color={OVERVIEW_CHART_ACCENT} />
      </div>
    );
  };

  return (
    <div className="p-3 rounded-lg bg-card border border-border shrink-0 grid grid-cols-2 gap-3 content-start">
      {tile(CheckCircle2, `Success Rate (${tfLabel})`, `${data.successRate.value}%`)}
      {tile(Server, `Orchestrators (${tfLabel})`, data.orchestratorsOnline.value)}
      {tile(Clock, `Usage (${tfLabel})`, formatNumber(data.dailyUsageMins.value), 'mins', data.hourlyUsage, 'Total transcoding minutes. Sparkline: one bar per UTC hour.')}
      {tile(Radio, `Sessions (${tfLabel})`, data.dailySessionCount.value.toLocaleString(), undefined, data.hourlySessions, 'Demand sessions. Sparkline: one bar per UTC hour.')}
    </div>
  );
}

function ProtocolCard({ data, className }: { data: DashboardProtocol; className?: string }) {
  const progressPct = data.totalBlocks > 0
    ? Math.round((data.blockProgress / data.totalBlocks) * 100)
    : 0;

  return (
    <div className={className ?? 'p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col'}>
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
                className="h-full bg-primary rounded-full transition-all duration-500"
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

function FeesCard({ data, className }: { data: DashboardFeesInfo; className?: string }) {
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
        ? data.dayData.map((d) => ({ ts: d.dateS, volumeUsd: d.volumeUsd, volumeEth: d.volumeEth }))
        : data.weeklyData.map((w) => ({ ts: w.date, volumeUsd: w.weeklyVolumeUsd, volumeEth: w.weeklyVolumeEth }));
    return [...rows].sort((a, b) => b.ts - a.ts);
  }, [data.dayData, data.weeklyData, grouping]);

  return (
    <div className={className ?? 'p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col'}>
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
            {!hovered && pctChange != null ? <DeltaBadge value={pctChange} unit="%" /> : null}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {displayDate ?? (grouping === 'day' ? 'Latest day' : 'Latest full week')} • Total {formatUsdCompact(data.totalUsd)} ({data.totalEth.toFixed(2)} ETH)
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRawOpen((v) => !v)}
            className={`p-1 rounded transition-colors ${rawOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
            title={rawOpen ? 'Hide raw fees data' : 'View raw fees data'}
            aria-label={rawOpen ? 'Hide raw fees data' : 'View raw fees data'}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
            <button onClick={() => setGrouping('day')} aria-label="Show daily fees" aria-pressed={grouping === 'day'} className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${grouping === 'day' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>D</button>
            <button onClick={() => setGrouping('week')} aria-label="Show weekly fees" aria-pressed={grouping === 'week'} className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${grouping === 'week' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>W</button>
          </div>
        </div>
      </div>
      <div className="h-28">
        <FeesBarChart
          chartData={chartData}
          onMove={setHovered}
          onLeave={() => setHovered(null)}
          accent={OVERVIEW_CHART_ACCENT}
          cursor={OVERVIEW_CHART_CURSOR}
          formatUsdCompact={formatUsdCompact}
        />
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
                    <td className="px-2.5 py-1.5 text-foreground font-mono">{new Date(row.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
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

function ProtocolFeesCard({ protocol, fees }: { protocol: DashboardProtocol; fees: DashboardFeesInfo }) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col gap-4">
      <ProtocolCard data={protocol} className="flex flex-col shrink-0" />
      <div className="border-t border-border/50" />
      <FeesCard data={fees} className="flex flex-col flex-1 min-h-0" />
    </div>
  );
}

type GpuPipelineRow = DashboardGPUCapacity['pipelineGPUs'][number];

/**
 * Union NAAP gpu-capacity with catalog + demand so pipelines omitted upstream
 * (e.g. `llm`) still appear with 0 GPUs and known models listed.
 */
function mergeGpuCapacityPipelinesWithCatalog(
  fromApi: GpuPipelineRow[],
  catalog: DashboardPipelineCatalogEntry[],
  pipelines: DashboardPipelineUsage[],
): GpuPipelineRow[] {
  const clone = (p: GpuPipelineRow): GpuPipelineRow => ({
    name: p.name,
    gpus: p.gpus,
    models: (p.models ?? []).map((m) => ({ model: m.model, gpus: m.gpus })),
  });

  const byName = new Map<string, GpuPipelineRow>();
  for (const p of fromApi) {
    byName.set(p.name, clone(p));
  }

  for (const entry of catalog) {
    if (PIPELINE_DISPLAY[entry.id] === null) continue;

    const usage = pipelines.find((u) => u.name === entry.id);
    const modelIds = new Set<string>([...entry.models]);
    for (const mm of usage?.modelMins ?? []) {
      const m = mm.model?.trim();
      if (m) modelIds.add(m);
    }

    let row = byName.get(entry.id);
    if (!row) {
      byName.set(entry.id, {
        name: entry.id,
        gpus: 0,
        models: [...modelIds].sort((a, b) => a.localeCompare(b)).map((model) => ({ model, gpus: 0 })),
      });
      continue;
    }

    const byModel = new Map<string, number>();
    for (const m of row.models ?? []) {
      byModel.set(m.model, m.gpus);
    }
    for (const model of modelIds) {
      if (!byModel.has(model)) {
        byModel.set(model, 0);
      }
    }
    row = {
      name: row.name,
      gpus: row.gpus,
      models: [...byModel.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([model, gpus]) => ({ model, gpus })),
    };
    byName.set(entry.id, row);
  }

  for (const u of pipelines) {
    if (PIPELINE_DISPLAY[u.name] === null) continue;
    if (byName.has(u.name)) continue;
    const modelIds = new Set<string>();
    for (const mm of u.modelMins ?? []) {
      const m = mm.model?.trim();
      if (m) modelIds.add(m);
    }
    if (modelIds.size === 0) continue;
    byName.set(u.name, {
      name: u.name,
      gpus: 0,
      models: [...modelIds].sort((a, b) => a.localeCompare(b)).map((model) => ({ model, gpus: 0 })),
    });
  }

  const catalogOrder = [...catalog]
    .filter((e) => PIPELINE_DISPLAY[e.id] !== null)
    .sort((a, b) => {
      const am = pipelines.find((p) => p.name === a.id)?.mins ?? 0;
      const bm = pipelines.find((p) => p.name === b.id)?.mins ?? 0;
      return bm - am;
    })
    .map((e) => e.id);

  const out: GpuPipelineRow[] = [];
  const placed = new Set<string>();

  for (const id of catalogOrder) {
    const p = byName.get(id);
    if (p) {
      out.push(p);
      placed.add(id);
    }
  }

  for (const p of fromApi) {
    if (PIPELINE_DISPLAY[p.name] === null) continue;
    if (!placed.has(p.name)) {
      out.push(byName.get(p.name) ?? clone(p));
      placed.add(p.name);
    }
  }

  for (const [name, p] of byName) {
    if (!placed.has(name) && PIPELINE_DISPLAY[name] !== null) {
      out.push(p);
      placed.add(name);
    }
  }

  return out;
}

/** Per-model GPU counts from merged NAAP + catalog breakdown. */
function gpuCountMapFromMerged(merged: GpuPipelineRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of merged) {
    for (const row of p.models ?? []) {
      m.set(`${p.name}\x1f${row.model}`, row.gpus);
    }
  }
  return m;
}

/** Model rows: union catalog + usage so seeded/empty catalog entries still show demand. */
function pipelineTableModelIds(
  entry: DashboardPipelineCatalogEntry,
  pipelineUsage: DashboardPipelineUsage | undefined,
): string[] {
  const fromUsage = pipelineUsage?.modelMins?.map((m) => m.model).filter(Boolean) ?? [];
  const set = new Set<string>([...entry.models, ...fromUsage]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

type PipelineTableSortCol = 'model' | 'gpus' | 'capacity' | 'price' | 'fps' | 'mins';

function sortPipelineTableModels(
  models: string[],
  pipelineId: string,
  sortCol: PipelineTableSortCol,
  sortDir: 'asc' | 'desc',
  pipelineUsage: DashboardPipelineUsage | undefined,
  pricingByKey: Map<string, DashboardPipelinePricing>,
  netCapacity: Record<string, number>,
  liveVideoCapacity: Record<string, number>,
  gpuByPipelineModel: Map<string, number>,
  modelFpsByPipelineModel: Record<string, number>,
): string[] {
  const modelMinsMap = new Map(pipelineUsage?.modelMins?.map((m) => [m.model, m]) ?? []);
  const rowKeys = (model: string) => {
    const p = pricingByKey.get(`${pipelineId}:${model}`);
    const modelUsage = modelMinsMap.get(model);
    const modelFpsFromPerf = modelFpsByPipelineModel[`${pipelineId}:${model}`];
    const modelFps = Number.isFinite(modelFpsFromPerf)
      ? modelFpsFromPerf
      : Number.isFinite(modelUsage?.avgFps) ? (modelUsage?.avgFps as number) : null;
    const modelMins = Number.isFinite(modelUsage?.mins) ? (modelUsage?.mins as number) : null;
    const cap = pipelinesRowCapacity(pipelineId, model, p, netCapacity, liveVideoCapacity);
    const gpus = gpuByPipelineModel.get(`${pipelineId}\x1f${model}`) ?? 0;
    const price = p && p.price > 0 ? p.price : null;
    return { cap, gpus, price, modelFps, modelMins };
  };
  return [...models].sort((a, b) => {
    const ra = rowKeys(a);
    const rb = rowKeys(b);
    let c = 0;
    const missingLast = (aMissing: boolean, bMissing: boolean, inner: number): number => {
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return inner;
    };
    switch (sortCol) {
      case 'model':
        c = a.localeCompare(b);
        break;
      case 'gpus':
        c = ra.gpus - rb.gpus;
        break;
      case 'capacity':
        c = missingLast(
          ra.cap === '—',
          rb.cap === '—',
          (ra.cap as number) - (rb.cap as number),
        );
        break;
      case 'price':
        c = missingLast(
          ra.price == null,
          rb.price == null,
          (ra.price ?? 0) - (rb.price ?? 0),
        );
        break;
      case 'fps':
        c = missingLast(
          ra.modelFps == null,
          rb.modelFps == null,
          (ra.modelFps ?? 0) - (rb.modelFps ?? 0),
        );
        break;
      case 'mins':
        c = missingLast(
          ra.modelMins == null,
          rb.modelMins == null,
          (ra.modelMins ?? 0) - (rb.modelMins ?? 0),
        );
        break;
    }
    if (c !== 0) return sortDir === 'asc' ? c : -c;
    return a.localeCompare(b);
  });
}

function pipelineCopyInlineHoverCls(
  scope: 'default' | 'pipeline' | 'model' | 'feed',
): string {
  const base =
    'rounded p-0.5 shrink-0 text-muted-foreground hover:text-foreground opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';
  switch (scope) {
    case 'pipeline':
      return `${base} group-hover/pipeline:opacity-100 group-focus-within/pipeline:opacity-100`;
    case 'model':
      return `${base} group-hover/model:opacity-100 group-focus-within/model:opacity-100`;
    case 'feed':
      return `${base} group-hover/feed:opacity-100 group-focus-within/feed:opacity-100`;
    default:
      return `${base} group-hover:opacity-100 group-focus-within:opacity-100`;
  }
}

function PipelineTableCopyButton({
  copied,
  onCopy,
  title,
  ariaLabel,
  inline = false,
  /** Named Tailwind group so pipeline-row buttons are not revealed when hovering model rows below. */
  inlineGroup = 'default',
}: {
  copied: boolean;
  onCopy: () => void | Promise<void>;
  title: string;
  ariaLabel: string;
  /** Match developer-api Models tab: icon sits after label, hidden until hover/focus. */
  inline?: boolean;
  inlineGroup?: 'default' | 'pipeline' | 'model' | 'feed';
}) {
  const cls = inline
    ? pipelineCopyInlineHoverCls(inlineGroup)
    : 'p-0.5 rounded-md shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={`${cls}${copied ? ' !opacity-100' : ''}`.trim()}
      title={title}
      aria-label={ariaLabel}
    >
      {copied ? (
        <Check className="w-3 h-3 text-primary" aria-hidden />
      ) : (
        <Copy className="w-3 h-3" aria-hidden />
      )}
    </button>
  );
}

function PipelineSortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: PipelineTableSortCol;
  sortCol: PipelineTableSortCol;
  sortDir: 'asc' | 'desc';
}) {
  if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />;
  return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />;
}

function PipelineTH({
  col,
  label,
  className,
  sortCol,
  sortDir,
  onSort,
}: {
  col: PipelineTableSortCol;
  label: string;
  className: string;
  sortCol: PipelineTableSortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: PipelineTableSortCol) => void;
}) {
  const ariaSort: 'ascending' | 'descending' | 'none' =
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';
  return (
    <th scope="col" className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex w-full items-center gap-1 select-none hover:text-foreground transition-colors ${className.includes('text-right') ? 'justify-end' : 'justify-start'}`}
      >
        {className.includes('text-right') ? (
          <>
            <PipelineSortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
            {label}
          </>
        ) : (
          <>
            {label}
            <PipelineSortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
          </>
        )}
      </button>
    </th>
  );
}

function PipelinesCard({
  data,
  catalog,
  pricing,
  netCapacity,
  liveVideoCapacity,
  modelFpsByPipelineModel,
  timeframeHours,
  gpuCapacity,
}: {
  data: DashboardPipelineUsage[];
  catalog: DashboardPipelineCatalogEntry[];
  pricing: DashboardPipelinePricing[];
  netCapacity: Record<string, number>;
  liveVideoCapacity: Record<string, number>;
  modelFpsByPipelineModel: Record<string, number>;
  timeframeHours: number;
  gpuCapacity: DashboardGPUCapacity | null;
}) {
  const [sortCol, setSortCol] = useState<PipelineTableSortCol>('model');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { copiedId, copyToClipboard } = useClipboardFlash();

  const togglePipelineTableSort = (col: PipelineTableSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'model' ? 'asc' : 'desc');
    }
  };

  const mergedGpuPipelines = useMemo(
    () =>
      mergeGpuCapacityPipelinesWithCatalog(
        gpuCapacity?.pipelineGPUs ?? [],
        catalog,
        data,
      ),
    [gpuCapacity?.pipelineGPUs, catalog, data],
  );

  const gpuByPipelineModel = useMemo(
    () => gpuCountMapFromMerged(mergedGpuPipelines),
    [mergedGpuPipelines],
  );

  const pipelineGpuTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of mergedGpuPipelines) {
      m.set(p.name, p.gpus);
    }
    return m;
  }, [mergedGpuPipelines]);

  const pipelineUsageByName = useMemo(
    () => new Map(data.map((d) => [d.name, d])),
    [data],
  );

  const pricingByKey = useMemo(
    () => new Map(pricing.map((p) => [`${p.pipeline}:${p.model ?? ''}`, p])),
    [pricing],
  );

  const sortedCatalog = useMemo(
    () =>
      [...catalog]
        .filter((entry) => PIPELINE_DISPLAY[entry.id] != null)
        .sort((a, b) => {
          const aGpu = pipelineGpuTotals.get(a.id) ?? 0;
          const bGpu = pipelineGpuTotals.get(b.id) ?? 0;
          if (bGpu !== aGpu) return bGpu - aGpu;
          return (pipelineUsageByName.get(b.id)?.mins ?? 0) - (pipelineUsageByName.get(a.id)?.mins ?? 0);
        }),
    [catalog, pipelineUsageByName, pipelineGpuTotals],
  );

  const tf = formatTimeframeLabel(timeframeHours).toUpperCase();

  const thNum = 'pb-1.5 pt-1 px-2 font-medium text-right align-bottom tabular-nums';
  const thModel = 'pb-1.5 pt-1 pl-4 pr-2 font-medium text-left align-bottom';
  const tdModel = 'py-1 pl-4 pr-2 align-top break-words min-w-0';
  const tdNum = 'py-1 px-2 text-right tabular-nums align-top whitespace-nowrap';

  return (
    <div className="p-4 rounded-lg bg-card border border-border flex flex-col min-h-[240px] max-h-[min(72vh,680px)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0" title="GPU column from network capacity API">
            <LivepeerMarkIcon className="w-3.5 h-3.5 shrink-0" />
          </div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Pipelines & GPUs ({tf})
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {gpuCapacity != null ? (
            <p className="text-sm font-semibold text-foreground tabular-nums text-right leading-tight">
              {formatNumber(gpuCapacity.totalGPUs)} GPUs
            </p>
          ) : null}
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0">
            <Activity className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
      {sortedCatalog.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No pipeline data available</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border/60">
          <table className="w-full table-fixed text-[11px] border-collapse">
            <colgroup>
              <col className="min-w-0 w-[30%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[20%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card border-b border-border shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <PipelineTH col="model" label="Model" className={thModel} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
                <PipelineTH col="gpus" label="GPUs" className={thNum} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
                <PipelineTH col="capacity" label="Capacity" className={thNum} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
                <PipelineTH col="price" label="Price" className={thNum} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
                <PipelineTH col="fps" label="FPS" className={thNum} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
                <PipelineTH col="mins" label="Mins" className={`${thNum} pr-4`} sortCol={sortCol} sortDir={sortDir} onSort={togglePipelineTableSort} />
              </tr>
            </thead>
            <tbody>
              {sortedCatalog.map((entry) => {
                const color = PIPELINE_COLOR[entry.id] ?? DEFAULT_PIPELINE_COLOR;
                const pipelineUsage = pipelineUsageByName.get(entry.id);
                const modelRowsBase = pipelineTableModelIds(entry, pipelineUsage);
                const modelRows = sortPipelineTableModels(
                  modelRowsBase,
                  entry.id,
                  sortCol,
                  sortDir,
                  pipelineUsage,
                  pricingByKey,
                  netCapacity,
                  liveVideoCapacity,
                  gpuByPipelineModel,
                  modelFpsByPipelineModel,
                );
                const pipeTotal = pipelineGpuTotals.get(entry.id) ?? 0;
                const pipeMins = pipelineUsage?.mins != null && Number.isFinite(pipelineUsage.mins)
                  ? Math.round(pipelineUsage.mins as number)
                  : null;
                const pipeSessions = pipelineUsage?.sessions != null && Number.isFinite(pipelineUsage.sessions)
                  ? pipelineUsage.sessions as number
                  : null;
                return (
                  <Fragment key={entry.id}>
                    <tr className="bg-muted/40 border-b border-border/50" title={pipeSessions != null ? `${formatNumber(pipeSessions)} sessions (pipeline)` : undefined}>
                      <td className="py-1 pl-3 pr-2 align-middle">
                        <div className="group/pipeline flex min-w-0 items-center gap-2">
                          <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                          <span className="min-w-0 truncate text-xs font-semibold text-foreground">{entry.id}</span>
                          <PipelineTableCopyButton
                            inline
                            inlineGroup="pipeline"
                            copied={copiedId === `p:${entry.id}`}
                            onCopy={() => copyToClipboard(`p:${entry.id}`, entry.id)}
                            title="Copy pipeline id"
                            ariaLabel={`Copy pipeline id ${entry.id}`}
                          />
                        </div>
                      </td>
                      <td className={`${tdNum} align-middle font-mono text-xs font-semibold text-foreground`} title="GPUs on this pipeline">
                        {formatNumber(pipeTotal)}
                      </td>
                      <td className="px-2 py-1 align-middle" />
                      <td className="px-2 py-1 align-middle" />
                      <td className="px-2 py-1 align-middle" />
                      <td className={`${tdNum} pr-4 align-middle text-xs font-semibold tabular-nums text-foreground`} title="Total demand minutes (pipeline)">
                        {pipeMins != null ? formatNumber(pipeMins) : '—'}
                      </td>
                    </tr>
                    {modelRows.length === 0 ? (
                      <tr className="border-b border-border/30">
                        <td colSpan={6} className="py-2 pl-6 text-[10px] text-muted-foreground">No models</td>
                      </tr>
                    ) : (
                      modelRows.map((model) => {
                        const p = pricingByKey.get(`${entry.id}:${model}`);
                        const modelUsage = pipelineUsage?.modelMins?.find((m) => m.model === model);
                        const modelFpsFromPerf = modelFpsByPipelineModel[`${entry.id}:${model}`];
                        const modelFps = Number.isFinite(modelFpsFromPerf)
                          ? modelFpsFromPerf
                          : Number.isFinite(modelUsage?.avgFps) ? (modelUsage?.avgFps as number) : null;
                        const modelMins = Number.isFinite(modelUsage?.mins) ? (modelUsage?.mins as number) : null;
                        const priceStr = p && p.price > 0 ? `${formatNumber(Math.round(p.price * 1e12))} wei/${p.unit}` : '—';
                        const cap = pipelinesRowCapacity(entry.id, model, p, netCapacity, liveVideoCapacity);
                        const gpus = gpuByPipelineModel.get(`${entry.id}\x1f${model}`) ?? 0;
                        return (
                          <tr key={`${entry.id}:${model}`} className="border-b border-border/25 hover:bg-muted/20">
                            <td className={`${tdModel} group/model`}>
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate font-mono text-[10px] leading-snug" style={{ color }}>{model}</span>
                                <PipelineTableCopyButton
                                  inline
                                  inlineGroup="model"
                                  copied={copiedId === `m:${entry.id}:${model}:id`}
                                  onCopy={() => copyToClipboard(`m:${entry.id}:${model}:id`, model)}
                                  title="Copy model id"
                                  ariaLabel={`Copy model id ${model}`}
                                />
                              </div>
                            </td>
                            <td className={tdNum}>{formatNumber(gpus)}</td>
                            <td className={tdNum}>{cap === '—' ? '—' : formatNumber(cap)}</td>
                            <td className={`${tdNum} text-muted-foreground`}>{priceStr}</td>
                            <td className={`${tdNum} text-muted-foreground`}>{modelFps != null ? modelFps.toFixed(1) : '—'}</td>
                            <td className={`${tdNum} pr-4 text-muted-foreground`}>{modelMins != null ? formatNumber(Math.round(modelMins)) : '—'}</td>
                          </tr>
                        );
                      })
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Job Feed Card
// ============================================================================

type JobFeedSortCol = 'model' | 'outputFps' | 'durationSeconds' | 'status';

function JobFeedCard({
  jobs,
  connected,
  pollInterval,
  onPollIntervalChange,
  feedMeta,
  feedError,
  feedLoading,
}: {
  jobs: JobFeedEntry[];
  connected: boolean;
  pollInterval: number;
  onPollIntervalChange: (ms: number) => void;
  feedMeta: JobFeedConnectionMeta | null;
  feedError: DashboardError | null;
  feedLoading: boolean;
}) {
  const [sortCol, setSortCol] = useState<JobFeedSortCol>('durationSeconds');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { copiedId, copyToClipboard } = useClipboardFlash();

  const toggleSort = (col: JobFeedSortCol) => {
    if (sortCol === col) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortCol(col); setSortDir(col === 'durationSeconds' ? 'asc' : 'desc'); }
  };

  const sorted = useMemo(() => {
    return [...jobs].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      const am = jobFeedRowModelLabel(a);
      const bm = jobFeedRowModelLabel(b);
      const aLast = a.lastSeen ?? a.startedAt ?? '';
      const bLast = b.lastSeen ?? b.startedAt ?? '';
      switch (sortCol) {
        case 'model': av = am === '—' ? '' : am; bv = bm === '—' ? '' : bm; break;
        case 'outputFps': av = a.outputFps ?? 0; bv = b.outputFps ?? 0; break;
        case 'durationSeconds': av = a.durationSeconds ?? 0; bv = b.durationSeconds ?? 0; break;
        case 'status': av = a.status; bv = b.status; break;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        const cmp = sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        if (cmp !== 0) return cmp;
      } else {
        const cmp = sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
        if (cmp !== 0) return cmp;
      }
      if (aLast !== bLast) return bLast.localeCompare(aLast);
      return a.id.localeCompare(b.id);
    });
  }, [jobs, sortCol, sortDir]);

  const SortIcon = ({ col }: { col: JobFeedSortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const jobFeedThAriaSort = (col: JobFeedSortCol): 'ascending' | 'descending' | 'none' =>
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const TH = ({ col, label, right }: { col: JobFeedSortCol; label: string; right?: boolean }) => (
    <th
      scope="col"
      className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'}`}
      aria-sort={jobFeedThAriaSort(col)}
    >
      <button type="button" onClick={() => toggleSort(col)} className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`}>
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
    <div className="p-4 rounded-lg bg-card border border-border h-full min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 mb-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-muted text-emerald-400 shrink-0"><Zap className="w-3.5 h-3.5" /></div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Live Job Feed</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <JobFeedPollIntervalSelector value={pollInterval} onChange={onPollIntervalChange} />
          {connected && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 max-h-[11.4375rem] overflow-x-auto overflow-y-scroll [scrollbar-gutter:stable]">
        {feedLoading && jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-2">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin mb-2" aria-hidden />
            <span className="text-xs text-muted-foreground">Loading job feed…</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center px-2">
            <Radio className="w-5 h-5 text-muted-foreground/30 mb-2" />
            <span className="text-xs text-muted-foreground">
              {feedError
                ? feedError.message
                : feedMeta?.fetchFailed
                  ? 'Could not load the job feed. Check the network or try again.'
                  : feedMeta && !feedMeta.clickhouseConfigured
                    ? 'Live job feed is not configured on the server.'
                    : feedMeta?.queryFailed
                      ? 'Live job feed query failed. See server logs for details.'
                      : 'No active streams'}
            </span>
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
                const { pipelineLabel } = jobFeedPipelineParts(job.pipeline);
                const modelLabel = jobFeedRowModelLabel(job);
                const pipelineIdForColor = jobFeedResolvePipelineId(job.pipeline);
                const pipelineDotColor = pipelineIdForColor
                  ? (PIPELINE_COLOR[pipelineIdForColor] ?? DEFAULT_PIPELINE_COLOR)
                  : DEFAULT_PIPELINE_COLOR;
                const rowTooltip = [
                  `Stream: ${job.id}`, `Pipeline: ${pipelineLabel}`,
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
                const rawPipeline = job.pipeline.trim();
                const hasModel = modelLabel !== '—';
                return (
                  <tr key={job.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-default group/feed" title={rowTooltip}>
                    <td className="py-1.5">
                      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 max-w-[280px]">
                        <span
                          className="w-2 h-2 rounded-full shrink-0 ring-1 ring-border/40"
                          style={{ backgroundColor: pipelineDotColor }}
                          title={pipelineLabel}
                          aria-label={`Pipeline: ${pipelineLabel}`}
                        />
                        {hasModel ? (
                          <>
                            <span
                              className="font-mono text-[10px] leading-snug truncate min-w-0 max-w-[220px]"
                              style={{ color: pipelineDotColor }}
                            >
                              {modelLabel}
                            </span>
                            <PipelineTableCopyButton
                              inline
                              inlineGroup="feed"
                              copied={copiedId === `jf-m:${job.id}`}
                              onCopy={() => copyToClipboard(`jf-m:${job.id}`, modelLabel)}
                              title="Copy model id"
                              ariaLabel={`Copy model id ${modelLabel}`}
                            />
                          </>
                        ) : (
                          <>
                            <span
                              className="font-mono text-[10px] leading-snug truncate min-w-0 max-w-[220px]"
                              style={{ color: pipelineDotColor }}
                              title={rawPipeline || undefined}
                            >
                              {rawPipeline || '—'}
                            </span>
                            {rawPipeline ? (
                              <PipelineTableCopyButton
                                inline
                                inlineGroup="feed"
                                copied={copiedId === `jf-p:${job.id}`}
                                onCopy={() => copyToClipboard(`jf-p:${job.id}`, rawPipeline)}
                                title="Copy pipeline id"
                                ariaLabel={`Copy pipeline id ${rawPipeline}`}
                              />
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-mono text-foreground">{job.inputFps != null && job.outputFps != null ? `${job.inputFps} / ${job.outputFps}` : '—'}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{job.runningFor ?? '—'}</td>
                    <td className="py-1.5 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusStyles[job.status] ?? ''}`}>{job.status}</span>
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

type OrchestratorSortCol = 'uri' | 'knownSessions' | 'successRatio' | 'effectiveSuccessRate' | 'slaScore' | 'gpuCount';

function formatPipelineLabel(
  pipelineId: string,
  catalog: DashboardPipelineCatalogEntry[] | null | undefined,
  modelIds?: string[] | null,
): string {
  const entry = catalog?.find((p) => p.id === pipelineId);
  const name = entry?.name ?? pipelineId;
  if (modelIds?.length) return `${name} (${modelIds.join(', ')})`;
  return name;
}

function OrchestratorTableCard({ data, catalog }: { data: DashboardOrchestrator[]; catalog?: DashboardPipelineCatalogEntry[] | null }) {
  const [sortCol, setSortCol] = useState<OrchestratorSortCol>('knownSessions');
  const formatURI = (uri?: string) => {
    if (!uri) return '—';
    const stripped = uri.replace(/^https?:\/\//, '');
    return stripped.length > 30 ? `${stripped.slice(0, 27)}…` : stripped;
  };
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const { copiedId, copyToClipboard } = useClipboardFlash();

  const toggleSort = (col: OrchestratorSortCol) => {
    if (sortCol === col) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: OrchestratorSortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const sorted = useMemo(() => {
    let rows = [...data];
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter((r) => {
        if (r.address.toLowerCase().includes(q)) return true;
        if (r.uris.some(u => u.toLowerCase().includes(q))) return true;
        return r.pipelines.some((p) => {
          const offer = r.pipelineModels?.find((o) => o.pipelineId === p);
          const label = formatPipelineLabel(p, catalog, offer?.modelIds);
          return label.toLowerCase().includes(q) || p.toLowerCase().includes(q);
        });
      });
    }
    rows.sort((a, b) => {
      const av = sortCol === 'uri' ? (a.uris[0] ?? '') : (a[sortCol] ?? 0);
      const bv = sortCol === 'uri' ? (b.uris[0] ?? '') : (b[sortCol] ?? 0);
      if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [data, sortCol, sortDir, filter, catalog]);

  const ariaSortValue = (col: OrchestratorSortCol): 'ascending' | 'descending' | 'none' =>
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const TH = ({ col, label, right, className = '' }: { col: OrchestratorSortCol; label: string; right?: boolean; className?: string }) => (
    <th className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`.trim()} aria-sort={ariaSortValue(col)}>
      <button type="button" onClick={() => toggleSort(col)} className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`} aria-label={`Sort by ${label}`}>
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
          <div className="p-1 rounded-md bg-muted text-muted-foreground"><Server className="w-3.5 h-3.5" /></div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Orchestrators ({sorted.length}{filter ? ` of ${data.length}` : ''}) · {totalGPUsInList} GPUs</span>
        </div>
        <input
          id="orchestrator-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter URI / pipeline…"
          aria-label="Filter orchestrators by URI, address, or pipeline"
          className="px-2 py-0.5 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground w-48"
        />
      </div>
      <div className="max-h-[min(70vh,640px)] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground border-b border-border">
            <tr>
              <TH col="uri" label="URI" />
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
              <tr key={row.address} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
                <td className="py-1.5 min-w-0" title={row.uris.length ? row.uris.join('\n') : row.address}>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-mono text-foreground truncate">{formatURI(row.uris[0])}</span>
                    {row.uris.length > 1 && (
                      <span className="shrink-0 px-1 py-px text-[10px] rounded bg-muted text-muted-foreground font-medium" title={row.uris.slice(1).join('\n')}>+{row.uris.length - 1}</span>
                    )}
                    {(row.uris[0] || row.address) ? (
                      <PipelineTableCopyButton
                        inline
                        copied={copiedId === `orch:${row.address}`}
                        onCopy={() =>
                          copyToClipboard(`orch:${row.address}`, row.uris[0] || row.address)
                        }
                        title="Copy orchestrator URI"
                        ariaLabel={`Copy URI ${row.uris[0] ?? row.address}`}
                      />
                    ) : null}
                  </div>
                </td>
                <td className="py-1.5 text-right font-mono">{row.knownSessions.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono">{row.successRatio}%</td>
                <td className="py-1.5 text-right font-mono">{row.effectiveSuccessRate != null ? `${row.effectiveSuccessRate}%` : '—'}</td>
                <td className="py-1.5 text-right font-mono">{row.slaScore ?? '—'}</td>
                <td className="py-1.5 pr-5 text-right font-mono">{row.gpuCount}</td>
                <td className="py-1.5 pl-2 max-w-[180px]">
                  <div className="flex flex-wrap gap-1">
                    {row.pipelines.length === 0 && '—'}
                    {row.pipelines.map((p) => {
                      const offer = row.pipelineModels?.find((o) => o.pipelineId === p);
                      const modelIds = offer?.modelIds ?? [];
                      const entry = catalog?.find((c) => c.id === p);
                      const pipelineName = entry?.name ?? p;
                      return modelIds.length > 0 ? (
                        modelIds.map((modelId) => (
                          <span key={`${p}:${modelId}`} className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${modelBadgeColor(modelId)}`} title={pipelineName}>{modelId}</span>
                        ))
                      ) : (
                        <span key={p} className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground" title={pipelineName}>—</span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">{filter ? 'No orchestrators match the filter' : 'No orchestrator data'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Selectors
// ============================================================================

const JOB_FEED_POLL_OPTIONS = [
  { label: '5s', value: 5_000 },
  { label: '15s', value: 15_000 },
  { label: '30s', value: 30_000 },
  { label: '90s', value: 90_000 },
] as const;

function JobFeedPollIntervalSelector({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
      <Timer className="w-3 h-3 text-muted-foreground ml-1" />
      {JOB_FEED_POLL_OPTIONS.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)} className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors duration-100 ${value === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{opt.label}</button>
      ))}
    </div>
  );
}

const TIMEFRAME_OPTIONS = [
  { label: '1h', value: '1', description: 'Last hour' },
  { label: '6h', value: '6', description: 'Last 6 hours' },
  { label: '12h', value: '12', description: 'Last 12 hours' },
  { label: '18h', value: '18', description: 'Last 18 hours' },
  { label: '24h', value: '24', description: 'Last 24 hours (max)' },
] as const;

const DEFAULT_TIMEFRAME = '12';

function TimeframeSelector({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = TIMEFRAME_OPTIONS.find((o) => o.value === value) ?? TIMEFRAME_OPTIONS.find((o) => o.value === DEFAULT_TIMEFRAME)!;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/30 border border-border hover:bg-muted/50 transition-colors" aria-haspopup="listbox" aria-expanded={open} aria-label="Select timeframe">
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">{selected.label}</span>
        <ChevronsUpDown className="w-3 h-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-md bg-card border border-border shadow-lg z-50" role="listbox">
          {TIMEFRAME_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }} className={`w-full px-3 py-2 text-left text-xs transition-colors first:rounded-t-md last:rounded-b-md ${value === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`} role="option" aria-selected={value === opt.value}>
              <div className="font-medium">{opt.label}</div>
              <div className="text-[10px] opacity-70">{opt.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardHeader({ timeframe, onTimeframeChange }: { timeframe: string; onTimeframeChange: (tf: string) => void }) {
  return (
    <div className="flex items-end justify-between">
      <div className="space-y-0.5">
        <h1 className="text-lg font-semibold text-foreground">Network Platform</h1>
        <p className="text-[13px] text-muted-foreground">Overview</p>
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

// ============================================================================
// Main OverviewContent
// ============================================================================

export function OverviewContent(props: OverviewContentProps) {
  const {
    isPublic, kpi, pipelines, pipelineCatalog, orchestrators, protocol,
    gpuCapacity, pricing, fees, jobs, jobFeedConnected, jobFeedPollInterval,
    onJobFeedPollIntervalChange, jobFeedMeta, jobFeedError, jobFeedLoading, timeframe,
    onTimeframeChange, lbLoading, rtLoading, feesLoading, lbRefreshing,
    rtRefreshing, feesRefreshing, lbError, rtError, feesError, prefsReady,
  } = props;

  // Supplementary REST enrichment (capacity, live-video, perf-by-model)
  const [netCapacity, setNetCapacity] = useState<Record<string, number>>({});
  const [liveVideoCapacity, setLiveVideoCapacity] = useState<Record<string, number>>({});
  const [modelFpsByPipelineModel, setModelFpsByPipelineModel] = useState<Record<string, number>>({});
  const lastFetchedNetCapacityKeyRef = useRef<string | null>(null);
  const liveVideoCapacityModelsRef = useRef<string>('');

  useEffect(() => {
    if (!prefsReady) return;
    if (!pipelineCatalog?.length || !pricing.length) return;

    const catalogKeyPart = [...pipelineCatalog]
      .map((e) => ({ id: e.id, models: [...e.models].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const pricingKeyPart = [...pricing]
      .map((p) => ({ pipeline: p.pipeline, model: p.model ?? '', capacity: p.capacity ?? null }))
      .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.model.localeCompare(b.model));
    const key = JSON.stringify({ catalog: catalogKeyPart, pricing: pricingKeyPart });

    if (!catalogNeedsNetCapacityFetch(pipelineCatalog, pricing)) {
      lastFetchedNetCapacityKeyRef.current = null;
      setNetCapacity({});
      return;
    }
    if (lastFetchedNetCapacityKeyRef.current === key) return;

    let cancelled = false;
    fetch('/api/v1/network/capacity')
      ?.then((res) => (res.ok ? res.json() : null))
      ?.then((body: { capacityByPipelineModel?: Record<string, number> } | null) => {
        if (cancelled || !body?.capacityByPipelineModel || typeof body.capacityByPipelineModel !== 'object') return;
        setNetCapacity(body.capacityByPipelineModel);
        lastFetchedNetCapacityKeyRef.current = key;
      })
      ?.catch(() => {});
    return () => { cancelled = true; };
  }, [prefsReady, pipelineCatalog, pricing]);

  useEffect(() => {
    if (!prefsReady || !pipelineCatalog?.length) return;
    const liveVideoEntry = pipelineCatalog.find((e) => e.id === LIVE_VIDEO_PIPELINE_ID);
    if (!liveVideoEntry?.models.length) return;
    const modelsKey = [...liveVideoEntry.models].sort().join(',');
    if (liveVideoCapacityModelsRef.current === modelsKey) return;
    liveVideoCapacityModelsRef.current = modelsKey;
    let cancelled = false;
    fetch(`/api/v1/network/live-video-capacity?models=${encodeURIComponent(liveVideoEntry.models.join(','))}`)
      ?.then((res) => (res.ok ? res.json() : null))
      ?.then((body: { capacityByModel?: Record<string, number> } | null) => {
        if (cancelled || !body?.capacityByModel || typeof body.capacityByModel !== 'object') return;
        setLiveVideoCapacity(body.capacityByModel);
      })
      ?.catch(() => { if (!cancelled) liveVideoCapacityModelsRef.current = ''; });
    return () => { cancelled = true; };
  }, [prefsReady, pipelineCatalog]);

  useEffect(() => {
    if (!prefsReady) return;
    const { start, end } = getTimeframeRangeIso(timeframe);
    let cancelled = false;
    fetch(`/api/v1/network/perf-by-model?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      ?.then((res) => (res.ok ? res.json() : null))
      ?.then((body: { fpsByPipelineModel?: Record<string, number> } | null) => {
        if (cancelled || !body?.fpsByPipelineModel || typeof body.fpsByPipelineModel !== 'object') return;
        setModelFpsByPipelineModel(body.fpsByPipelineModel);
      })
      ?.catch(() => {});
    return () => { cancelled = true; };
  }, [prefsReady, timeframe]);

  const transientDashboardErrors = useMemo(() => {
    return [lbError, rtError, feesError].filter(
      (e): e is NonNullable<typeof e> => e != null && e.type !== 'no-provider',
    );
  }, [lbError, rtError, feesError]);

  const uiLbLoading = lbLoading || !prefsReady;
  const uiRtLoading = rtLoading || !prefsReady;
  const uiFeesLoading = feesLoading || !prefsReady;

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      <DashboardHeader timeframe={timeframe} onTimeframeChange={onTimeframeChange} />

      {isPublic && <AuthCTABanner />}

      {transientDashboardErrors.length > 0 && (
        <div className="space-y-1.5">
          {transientDashboardErrors.map((e, i) => (
            <div key={i} className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-3 py-1.5 rounded-md flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Dashboard data may be stale — {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Row 1: [KPI + Live Job Feed | Protocol + Fees] */}
      <section>
        <div
          className="grid gap-3 items-stretch [&>*]:min-h-0"
          style={{ gridTemplateColumns: '3fr 2fr', minHeight: 'min(560px, 82vh)' }}
        >
          <div className="flex flex-col gap-3 min-h-0 h-full">
            {kpi ? (
              <RefreshWrap refreshing={lbRefreshing} className="shrink-0">
                <KPIGroupCard data={kpi} />
              </RefreshWrap>
            ) : uiLbLoading ? (
              <WidgetSkeleton className="shrink-0" />
            ) : (
              <WidgetUnavailable label="KPI" />
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              <JobFeedCard
                jobs={jobs}
                connected={jobFeedConnected}
                pollInterval={jobFeedPollInterval}
                onPollIntervalChange={onJobFeedPollIntervalChange}
                feedMeta={jobFeedMeta}
                feedError={jobFeedError}
                feedLoading={jobFeedLoading}
              />
            </div>
          </div>

          {protocol && fees ? (
            <RefreshWrap refreshing={rtRefreshing || feesRefreshing} className="h-full min-h-0 flex flex-col">
              <ProtocolFeesCard protocol={protocol} fees={fees} />
            </RefreshWrap>
          ) : (
            <div className="flex flex-col gap-3">
              {protocol ? <ProtocolCard data={protocol} /> : uiRtLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Protocol" />}
              {fees ? <FeesCard data={fees} /> : uiFeesLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Fees" />}
            </div>
          )}
        </div>
      </section>

      {/* Row 2: Pipelines + GPUs (single aligned table) */}
      <section>
        <div className="min-h-0 [&>*]:min-h-0">
          {pipelineCatalog != null && pipelineCatalog.length > 0 ? (
            <RefreshWrap refreshing={lbRefreshing} className="h-full min-h-0 flex flex-col">
              <PipelinesCard
                data={pipelines}
                catalog={pipelineCatalog}
                pricing={pricing}
                netCapacity={netCapacity}
                liveVideoCapacity={liveVideoCapacity}
                modelFpsByPipelineModel={modelFpsByPipelineModel}
                timeframeHours={kpi?.timeframeHours ?? 12}
                gpuCapacity={gpuCapacity ?? null}
              />
            </RefreshWrap>
          ) : uiLbLoading ? (
            <WidgetSkeleton />
          ) : (
            <WidgetUnavailable label="Pipelines" />
          )}
        </div>
      </section>

      {/* Row 3: Orchestrators (full width) */}
      <section>
        {orchestrators.length > 0 ? (
          <RefreshWrap refreshing={lbRefreshing} className="block min-h-0">
            <OrchestratorTableCard data={orchestrators} catalog={pipelineCatalog} />
          </RefreshWrap>
        ) : uiLbLoading ? (
          <WidgetSkeleton className="h-[320px]" />
        ) : (
          <WidgetUnavailable label="Orchestrators" />
        )}
      </section>
    </div>
  );
}
