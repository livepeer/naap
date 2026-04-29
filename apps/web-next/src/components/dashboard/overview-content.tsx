'use client';

/**
 * OverviewContent — shared rendering for the Network Overview dashboard.
 *
 * Used by both the public landing page (/) and the authenticated
 * dashboard (/dashboard). Data fetching is handled by the parent;
 * this component is purely presentational + supplementary REST enrichment.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { PIPELINE_COLOR, DEFAULT_PIPELINE_COLOR } from '@/lib/dashboard/pipeline-config';
import {
  formatOverviewTimeframeLabel,
  OVERVIEW_TIMEFRAME_OPTIONS,
} from '@/lib/dashboard/overview-timeframe';
import {
  LIVE_VIDEO_PIPELINE_ID,
  PIPELINE_ETH_USD_CLIENT_FALLBACK,
  pipelineTablePriceCellContent,
} from '@naap/utils';

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
  /**
   * When set, controls the orchestrator table skeleton independently of `lbLoading`
   * (e.g. authenticated dashboard loads orchestrators from the BFF while GraphQL stays on an older schema).
   */
  orchestratorsLoading?: boolean;
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

function PipelineTablePriceCell({
  pipelineId,
  wei,
  unit,
  modelFps,
  pipelineAvgFps,
  ethUsd,
  tdClass,
  ethUsdProvenance,
}: {
  pipelineId: string;
  wei: bigint | null;
  unit: string;
  modelFps: number | null;
  pipelineAvgFps: number | undefined;
  ethUsd: number;
  tdClass: string;
  ethUsdProvenance?: string | null;
}) {
  const { tipAnchor, tipOpen, triggerProps } = useOverviewPortaledDefinitionTooltip<HTMLButtonElement>();
  const { main, richLines } = pipelineTablePriceCellContent({
    pipelineId,
    wei,
    unit,
    modelFps,
    pipelineAvgFps,
    ethUsd,
    ethUsdProvenance,
  });
  const tip = richLines?.join('\n') ?? null;

  if (!tip) {
    return <td className={tdClass}>{main}</td>;
  }

  return (
    <td className={tdClass}>
      <button
        type="button"
        {...triggerProps}
        title={tip}
        className="group/cell w-full cursor-default border-b border-dotted border-muted-foreground/35 bg-transparent p-0 text-right font-inherit text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {main}
      </button>
      {tipOpen && tipAnchor ? (
        <OverviewDefinitionTooltipPortal anchor={tipAnchor}>
          {richLines!.map((line, i) => (
            <p key={i} className={i > 0 ? 'mt-1' : ''}>
              {line}
            </p>
          ))}
        </OverviewDefinitionTooltipPortal>
      ) : null}
    </td>
  );
}

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

/** Lossless avg wei for display/sort; GraphQL Float `price` can round to 0 for large wei. */
function avgWeiBigIntForPricingRow(p: DashboardPipelinePricing | undefined): bigint | null {
  if (!p) return null;
  const s = p.avgWeiPerUnit?.trim();
  if (s && /^\d+$/.test(s)) {
    try {
      const v = BigInt(s);
      if (v > 0n) return v;
    } catch {
      /* ignore invalid bigint */
    }
  }
  if (p.price > 0 && Number.isFinite(p.price)) {
    const r = Math.round(p.price * 1e12);
    if (r > 0 && Number.isFinite(r)) return BigInt(r);
  }
  return null;
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

/**
 * Maps hex values from PIPELINE_COLOR to Tailwind badge class pairs.
 * Covers every color in PIPELINE_COLOR so known model IDs always resolve
 * to a deterministic, semantically-aligned badge style.
 */
const MODEL_HEX_TO_BADGE_CLASSES: Record<string, string> = {
  '#9f1239': 'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
  '#10b981': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  '#8b5cf6': 'bg-violet-100  text-violet-800  dark:bg-violet-900/40  dark:text-violet-200',
  '#3b82f6': 'bg-sky-100     text-sky-800     dark:bg-sky-900/40     dark:text-sky-200',
  '#f59e0b': 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  '#84cc16': 'bg-lime-100    text-lime-800    dark:bg-lime-900/40    dark:text-lime-200',
  '#a855f7': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  '#06b6d4': 'bg-cyan-100    text-cyan-800    dark:bg-cyan-900/40    dark:text-cyan-200',
  '#ec4899': 'bg-pink-100    text-pink-800    dark:bg-pink-900/40    dark:text-pink-200',
  '#f97316': 'bg-orange-100  text-orange-800  dark:bg-orange-900/40  dark:text-orange-200',
  '#14b8a6': 'bg-teal-100    text-teal-800    dark:bg-teal-900/40    dark:text-teal-200',
  '#6366f1': 'bg-indigo-100  text-indigo-800  dark:bg-indigo-900/40  dark:text-indigo-200',
};

/**
 * Returns the hex color for a model ID.
 * Falls back to the parent pipeline's hex color if provided, then DEFAULT_PIPELINE_COLOR.
 */
function modelHexColor(modelId: string, fallbackHex?: string): string {
  return PIPELINE_COLOR[modelId] ?? fallbackHex ?? DEFAULT_PIPELINE_COLOR;
}

function hashModelId(modelId: string): number {
  let n = 0;
  for (let i = 0; i < modelId.length; i++) n += modelId.charCodeAt(i);
  return Math.abs(n) % MODEL_BADGE_COLORS.length;
}

/**
 * Returns Tailwind badge class string for a model ID.
 * Falls back to the parent pipeline's badge color if provided, then hash fallback.
 */
function modelBadgeColor(modelId: string, fallbackPipelineId?: string): string {
  const hex = PIPELINE_COLOR[modelId];
  if (hex) return MODEL_HEX_TO_BADGE_CLASSES[hex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  const fallbackHex = fallbackPipelineId ? PIPELINE_COLOR[fallbackPipelineId] : undefined;
  if (fallbackHex) return MODEL_HEX_TO_BADGE_CLASSES[fallbackHex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  return MODEL_BADGE_COLORS[hashModelId(modelId)];
}

/** Canonical pipeline id for theming (matches Pipelines & GPUs / PIPELINE_COLOR). */
function jobFeedResolvePipelineId(pipelineSlug: string): string {
  const s = pipelineSlug.trim();
  if (!s) return '';
  if (s === 'noop' || s.startsWith('streamdiffusion')) return LIVE_VIDEO_PIPELINE_ID;
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
      pipelineLabel: LIVE_VIDEO_PIPELINE_ID,
      modelLabel: slug,
      matched: true,
    };
  }

  return { pipelineLabel: slug, modelLabel: '—', matched: true };
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

/** KPI tile tooltip: matches upstream ClickHouse aggregation for GET /v1/dashboard/kpi. */
const SUCCESS_RATE_KPI_TOOLTIP =
  'Success rate (%) = 100 × (sum of startup_success_sessions) / (sum of requested_sessions) over the selected window, using hourly rows from ClickHouse table naap.api_hourly_streaming_demand, with optional filters on pipeline_id and model_id.';

const OVERVIEW_DEF_TOOLTIP_GAP_PX = 8;
const OVERVIEW_DEF_TOOLTIP_EDGE_PX = 12;
const OVERVIEW_DEF_TOOLTIP_PREF_WIDTH_PX = 336;

type OverviewDefAnchor = {
  left: number;
  top: number;
};

function useOverviewPortaledDefinitionTooltip<T extends HTMLElement>() {
  const triggerRef = useRef<T>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAnchor, setTipAnchor] = useState<OverviewDefAnchor | null>(null);

  const syncTipAnchor = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const preferredLeft = rect.right - OVERVIEW_DEF_TOOLTIP_PREF_WIDTH_PX;
    const maxLeft = window.innerWidth - OVERVIEW_DEF_TOOLTIP_PREF_WIDTH_PX - OVERVIEW_DEF_TOOLTIP_EDGE_PX;
    const left = Math.min(
      Math.max(preferredLeft, OVERVIEW_DEF_TOOLTIP_EDGE_PX),
      Math.max(maxLeft, OVERVIEW_DEF_TOOLTIP_EDGE_PX),
    );
    setTipAnchor({
      left,
      top: rect.bottom + OVERVIEW_DEF_TOOLTIP_GAP_PX,
    });
  }, []);

  useLayoutEffect(() => {
    if (!tipOpen) return;
    syncTipAnchor();
  }, [tipOpen, syncTipAnchor]);

  useEffect(() => {
    if (!tipOpen) return;
    const onReposition = () => syncTipAnchor();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [tipOpen, syncTipAnchor]);

  const triggerProps = {
    ref: triggerRef,
    onMouseEnter: () => {
      syncTipAnchor();
      setTipOpen(true);
    },
    onMouseLeave: () => setTipOpen(false),
    onFocus: () => {
      syncTipAnchor();
      setTipOpen(true);
    },
    onBlur: () => setTipOpen(false),
  };

  return { tipAnchor, tipOpen, triggerProps };
}

function OverviewDefinitionTooltipPortal(props: { anchor: OverviewDefAnchor; children: React.ReactNode }) {
  const { anchor, children } = props;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] w-[min(21rem,calc(100vw-1.5rem))] whitespace-normal break-words rounded-md border border-border bg-popover px-3 py-2 text-left text-[10px] leading-relaxed text-popover-foreground shadow-md"
      style={{ left: anchor.left, top: anchor.top }}
      role="tooltip"
    >
      {children}
    </div>,
    document.body,
  );
}

function KpiTileTitleWithDefinition(props: { label: string; definition: string }) {
  const { label, definition } = props;
  const { tipAnchor, tipOpen, triggerProps } = useOverviewPortaledDefinitionTooltip<HTMLButtonElement>();
  return (
    <>
      <span className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">
        <button
          type="button"
          {...triggerProps}
          className="cursor-default rounded-sm border-b border-dotted border-border/60 bg-transparent p-0 text-left font-inherit text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={definition}
        >
          {label}
        </button>
      </span>
      {tipOpen && tipAnchor ? (
        <OverviewDefinitionTooltipPortal anchor={tipAnchor}>
          <p>{definition}</p>
        </OverviewDefinitionTooltipPortal>
      ) : null}
    </>
  );
}

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
  const tfLabel = formatOverviewTimeframeLabel(data.timeframeHours);
  /**
   * Orchestrator snapshot has no timeframe filter upstream — label this tile with the
   * effective window implied by the oldest `LastSeen` instead of the selected timeframe.
   */
  const orchLabel =
    data.orchestratorsWindowHours != null && Number.isFinite(data.orchestratorsWindowHours)
      ? `~${formatOverviewTimeframeLabel(Math.max(1, Math.round(data.orchestratorsWindowHours)))}`
      : tfLabel;
  const orchTooltip =
    data.orchestratorsWindowHours != null
      ? 'Distinct orchestrator endpoints (Address + service URI) in the registry snapshot. Window is derived from the oldest LastSeen — the list endpoint does not accept a timeframe.'
      : undefined;

  const tile = (
    icon: ElementType,
    label: string,
    value: string | number,
    suffix?: string,
    sparkline?: HourlyBucket[],
    definition?: string,
  ) => {
    const Icon = icon;
    return (
      <div className="flex flex-col p-3 rounded-lg bg-muted/30 border border-border/50">
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0">
            <Icon className="w-3.5 h-3.5" />
          </div>
          {definition != null && definition !== '' ? (
            <KpiTileTitleWithDefinition label={label} definition={definition} />
          ) : (
            <span className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">
              {label}
            </span>
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
    <div className="grid shrink-0 grid-cols-2 gap-2 content-start rounded-lg border border-border bg-card p-2 sm:gap-3 sm:p-3">
      {tile(CheckCircle2, `Success Rate (${tfLabel})`, `${data.successRate.value.toFixed(1)}%`, undefined, undefined, SUCCESS_RATE_KPI_TOOLTIP)}
      {tile(Server, `Orchestrators (${orchLabel})`, data.orchestratorsObserved.value, undefined, undefined, orchTooltip)}
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
            <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground mb-1 sm:flex-row sm:items-center sm:justify-between sm:text-xs">
              <span>Block Progress</span>
              <span className="font-mono tabular-nums break-all sm:break-normal sm:text-right">{progressPct}% ({data.blockProgress.toLocaleString()} / {data.totalBlocks.toLocaleString()})</span>
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
      <div className="flex flex-col gap-3 mb-3 shrink-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-muted text-muted-foreground">
              <Coins className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Fees Paid</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-foreground font-mono">{formatUsd(displayValue)}</span>
            {!hovered && pctChange != null ? <DeltaBadge value={pctChange} unit="%" /> : null}
          </div>
          <div className="text-[10px] text-muted-foreground break-words">
            {displayDate ?? (grouping === 'day' ? 'Latest day' : 'Latest full week')} • Total {formatUsdCompact(data.totalUsd)} ({data.totalEth.toFixed(2)} ETH)
          </div>
        </div>
        <div className="flex items-center gap-1 self-end shrink-0 sm:self-start">
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
    <div className="flex h-full min-h-0 flex-col gap-4 rounded-lg border border-border bg-card p-3 sm:p-4">
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
    if (!placed.has(p.name)) {
      out.push(byName.get(p.name) ?? clone(p));
      placed.add(p.name);
    }
  }

  for (const [name, p] of byName) {
    if (!placed.has(name)) {
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
  return [...set];
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
    /** Only `streaming/models` (24h avg; live-video rows only per OpenAPI) — do not fall back to modelMins.avgFps (was coerced to 0 when missing). */
    const modelFps = Number.isFinite(modelFpsFromPerf) ? modelFpsFromPerf : null;
    const modelMins = Number.isFinite(modelUsage?.mins) ? (modelUsage?.mins as number) : null;
    const cap = pipelinesRowCapacity(pipelineId, model, p, netCapacity, liveVideoCapacity);
    const gpusRaw = gpuByPipelineModel.get(`${pipelineId}\x1f${model}`) ?? 0;
    const gpusN = Number(gpusRaw);
    const gpus = Number.isFinite(gpusN) ? gpusN : 0;
    const priceWei = avgWeiBigIntForPricingRow(p);
    return { cap, gpus, priceWei, modelFps, modelMins };
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
          ra.priceWei == null,
          rb.priceWei == null,
          ra.priceWei! < rb.priceWei! ? -1 : ra.priceWei! > rb.priceWei! ? 1 : 0,
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
    const tie = a.localeCompare(b);
    return sortDir === 'asc' ? tie : -tie;
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

const PIPELINE_TABLE_HEADER_DESCRIPTION: Record<PipelineTableSortCol, string> = {
  model:
    'Pipeline id on the summary row; model id on each detail row. Rows combine catalog seeds with usage so pipelines with demand still appear.',
  gpus:
    'Warm GPUs for the pipeline (summary row) or for the pipeline plus model (detail rows), merged from network capacity and the pipeline catalog.',
  capacity:
    'Published capacity for this model when the network exposes it (rules differ by pipeline type). Em dash when unknown.',
  price:
    'Estimated list price from orchestrator wei rates and the ETH/USD oracle. Live video: USD/min at 512×512 from wei/pixel and FPS. Text-to-image: USD per 512×512 image. Upscale: USD per 4×512² output. LLM-style pipelines: USD per 10k tokens. Other pipelines: wei per billing unit.',
  fps:
    'Average output FPS from GET /v1/streaming/models (24-hour weighted average; live-video-to-video models only). BFF-cached.',
  mins:
    'Usage minutes in the selected dashboard timeframe for the pipeline (summary) or for the model within that pipeline (detail).',
};

function PipelineTH({
  col,
  label,
  className,
  sortCol,
  sortDir,
  onSort,
  headerDescription,
}: {
  col: PipelineTableSortCol;
  label: string;
  className: string;
  sortCol: PipelineTableSortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: PipelineTableSortCol) => void;
  /** Hover / focus: portaled definition (dotted label), same pattern as Developer API Manager column headers. */
  headerDescription?: string;
}) {
  const { tipAnchor, tipOpen, triggerProps } = useOverviewPortaledDefinitionTooltip<HTMLButtonElement>();
  const ariaSort: 'ascending' | 'descending' | 'none' =
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';
  const right = className.includes('text-right');
  const hasDef = headerDescription != null && headerDescription !== '';
  const labelEl = hasDef ? (
    <span className="cursor-default border-b border-dotted border-border/60" aria-label={headerDescription}>
      {label}
    </span>
  ) : (
    label
  );
  return (
    <th scope="col" className={`${className} bg-card`.trim()} aria-sort={ariaSort}>
      <div
        className={`flex w-full items-center gap-0.5 ${right ? 'justify-end' : 'justify-start'}`}
      >
        <button
          type="button"
          {...(hasDef ? triggerProps : {})}
          onClick={() => onSort(col)}
          className={`inline-flex min-w-0 flex-1 items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'justify-end' : 'justify-start'}`}
        >
          {right ? (
            <>
              <PipelineSortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
              {labelEl}
            </>
          ) : (
            <>
              {labelEl}
              <PipelineSortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
            </>
          )}
        </button>
        {hasDef && tipOpen && tipAnchor ? (
          <OverviewDefinitionTooltipPortal anchor={tipAnchor}>
            <p>{headerDescription}</p>
          </OverviewDefinitionTooltipPortal>
        ) : null}
      </div>
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
  ethUsdOracle,
}: {
  data: DashboardPipelineUsage[];
  catalog: DashboardPipelineCatalogEntry[];
  pricing: DashboardPipelinePricing[];
  netCapacity: Record<string, number>;
  liveVideoCapacity: Record<string, number>;
  modelFpsByPipelineModel: Record<string, number>;
  timeframeHours: number;
  gpuCapacity: DashboardGPUCapacity | null;
  /** USD per 1 ETH (from GET /api/v1/dashboard/eth-usd). */
  ethUsdOracle: number;
}) {
  /** Default: GPUs descending so busy models surface first (was Model A–Z). */
  const [sortCol, setSortCol] = useState<PipelineTableSortCol>('gpus');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
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
        .sort((a, b) => {
          const aGpu = pipelineGpuTotals.get(a.id) ?? 0;
          const bGpu = pipelineGpuTotals.get(b.id) ?? 0;
          if (bGpu !== aGpu) return bGpu - aGpu;
          return (pipelineUsageByName.get(b.id)?.mins ?? 0) - (pipelineUsageByName.get(a.id)?.mins ?? 0);
        }),
    [catalog, pipelineUsageByName, pipelineGpuTotals],
  );

  const tf = formatOverviewTimeframeLabel(timeframeHours).toUpperCase();

  const thNum = 'pb-1.5 pt-1 px-2 font-medium text-right align-bottom tabular-nums';
  const thModel = 'pb-1.5 pt-1 pl-4 pr-2 font-medium text-left align-bottom';
  const tdModel = 'py-1 pl-4 pr-2 align-top break-words min-w-0';
  const tdNum = 'py-1 px-2 text-right tabular-nums align-top whitespace-nowrap';

  return (
    <div className="p-3 rounded-lg bg-card border border-border flex flex-col min-h-[240px] max-h-[min(72vh,680px)] min-w-0 overflow-hidden sm:p-4">
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
        <div className="flex-1 min-h-0 min-w-0 overflow-auto rounded-md border border-border/60 overscroll-x-contain">
          <table className="w-full min-w-[640px] table-fixed text-[11px] border-collapse">
            <colgroup>
              <col className="min-w-0 w-[30%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[20%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead className="sticky top-0 z-30 bg-card border-b border-border shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                <PipelineTH
                  col="model"
                  label="Model"
                  className={thModel}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.model}
                />
                <PipelineTH
                  col="gpus"
                  label="GPUs"
                  className={thNum}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.gpus}
                />
                <PipelineTH
                  col="capacity"
                  label="Capacity"
                  className={thNum}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.capacity}
                />
                <PipelineTH
                  col="price"
                  label="Price"
                  className={thNum}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.price}
                />
                <PipelineTH
                  col="fps"
                  label="FPS"
                  className={thNum}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.fps}
                />
                <PipelineTH
                  col="mins"
                  label="Mins"
                  className={`${thNum} pr-4`}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={togglePipelineTableSort}
                  headerDescription={PIPELINE_TABLE_HEADER_DESCRIPTION.mins}
                />
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
                        const modelFps = Number.isFinite(modelFpsFromPerf) ? modelFpsFromPerf : null;
                        const modelMins = Number.isFinite(modelUsage?.mins) ? (modelUsage?.mins as number) : null;
                        const wei = avgWeiBigIntForPricingRow(p);
                        const cap = pipelinesRowCapacity(entry.id, model, p, netCapacity, liveVideoCapacity);
                        const gpus = gpuByPipelineModel.get(`${entry.id}\x1f${model}`) ?? 0;
                        const pipeAvgFps = pipelineUsage?.avgFps;
                        return (
                          <tr key={`${entry.id}:${model}`} className="border-b border-border/25 hover:bg-muted/20">
                            <td className={`${tdModel} group/model`}>
                              <div className="flex min-w-0 items-center gap-1">
                                <span className={`inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium font-mono ${modelBadgeColor(model, entry.id)}`}>
                                  <span className="truncate">{model}</span>
                                </span>
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
                            <PipelineTablePriceCell
                              pipelineId={entry.id}
                              wei={wei}
                              unit={p?.unit ?? 'unit'}
                              modelFps={modelFps}
                              pipelineAvgFps={pipeAvgFps}
                              ethUsd={ethUsdOracle}
                              tdClass={`${tdNum} text-muted-foreground`}
                            />
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
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-2 mb-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-muted text-emerald-400 shrink-0"><Zap className="w-3.5 h-3.5" /></div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Live Job Feed</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <JobFeedPollIntervalSelector value={pollInterval} onChange={onPollIntervalChange} />
          {connected && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
            </div>
          )}
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 max-h-[11.4375rem] overflow-x-auto overflow-y-scroll overscroll-x-contain [scrollbar-gutter:stable]">
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
          <table className="w-full min-w-[340px] text-xs">
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
                  job.inputFps != null ? `Input FPS: ${job.inputFps.toFixed(1)}` : null,
                  job.outputFps != null ? `Output FPS: ${job.outputFps.toFixed(1)}` : null,
                  `Status: ${job.status}`,
                ].filter(Boolean).join('\n');
                const rawPipeline = job.pipeline.trim();
                const hasModel = modelLabel !== '—';
                return (
                  <tr key={job.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-default group/feed" title={rowTooltip}>
                    <td className="py-1.5">
                      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 min-w-0 max-w-full sm:max-w-[280px]">
                        <span
                          className="w-2 h-2 rounded-full shrink-0 ring-1 ring-border/40"
                          style={{ backgroundColor: pipelineDotColor }}
                          title={pipelineLabel}
                          aria-label={`Pipeline: ${pipelineLabel}`}
                        />
                        {hasModel ? (
                          <>
                            <span
                              className="font-mono text-[10px] leading-snug truncate min-w-0 max-w-full sm:max-w-[220px]"
                              style={{ color: modelHexColor(modelLabel, pipelineDotColor) }}
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
                              className="font-mono text-[10px] leading-snug truncate min-w-0 max-w-full sm:max-w-[220px]"
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
                    <td className="py-1.5 text-right font-mono text-foreground">{job.outputFps != null ? `${job.inputFps != null ? job.inputFps.toFixed(1) : '—'} / ${job.outputFps.toFixed(1)}` : '—'}</td>
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

function stripOrchestratorServiceUri(uri: string): string {
  return uri.replace(/^https?:\/\//, '');
}

/** Livepeer Explorer orchestrating view for an on-chain orchestrator address. */
const LIVEPEER_ORCHESTRATOR_EXPLORER_BASE = 'https://explorer.livepeer.org/accounts';

function livepeerOrchestratingExplorerHref(address: string): string | null {
  const a = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return null;
  return `${LIVEPEER_ORCHESTRATOR_EXPLORER_BASE}/${a.toLowerCase()}/orchestrating`;
}

/** Row after merge: stable key for React lists (blank addresses never share a bucket). */
type OrchestratorTableRow = DashboardOrchestrator & { stableRowKey: string };

/** One row per orchestrator address; union service URIs if the same address appears more than once. */
function mergeOrchestratorRowsByAddress(rows: DashboardOrchestrator[]): OrchestratorTableRow[] {
  const map = new Map<string, OrchestratorTableRow>();
  let blankSeq = 0;
  for (const row of rows) {
    const trimmed = row.address.trim();
    const key = trimmed === '' ? `__blank__${blankSeq++}` : trimmed.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, uris: [...row.uris], stableRowKey: key });
      continue;
    }
    const seen = new Set(existing.uris);
    const mergedUris = [...existing.uris];
    for (const u of row.uris) {
      if (u.trim() && !seen.has(u)) {
        seen.add(u);
        mergedUris.push(u);
      }
    }
    map.set(key, { ...existing, uris: mergedUris });
  }
  return [...map.values()];
}

function formatOrchestratorLastSeenForTooltip(iso: string | null | undefined): string {
  if (!iso?.trim()) return 'Last seen: —';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return `Last seen: ${iso}`;
  return `Last seen: ${new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function orchestratorModelPriceForTooltip(
  pricing: DashboardPipelinePricing | undefined,
  modelLabel: string,
): string {
  if (modelLabel === '—') return 'Price: —';
  const wei = avgWeiBigIntForPricingRow(pricing);
  if (wei != null) return `Price: ${wei.toLocaleString('en-US')} wei/${pricing?.unit ?? 'unit'}`;
  return 'Price: —';
}

/** Tooltip for model tags: last seen, network price, URI when unambiguous; else URI list. */
function orchestratorModelTagTooltip(
  pipelineName: string,
  modelLabel: string,
  uris: string[],
  opts: {
    lastSeen?: string | null;
    pricing?: DashboardPipelinePricing | undefined;
  },
): string {
  const lines = [
    `Model: ${modelLabel}`,
    `Pipeline: ${pipelineName}`,
    formatOrchestratorLastSeenForTooltip(opts.lastSeen),
    orchestratorModelPriceForTooltip(opts.pricing, modelLabel),
  ];
  if (uris.length === 1) {
    lines.push(`Service URI: ${stripOrchestratorServiceUri(uris[0])}`);
  } else if (uris.length > 1) {
    lines.push(
      'Models are aggregated per orchestrator address (not per URI). Service URIs:',
      ...uris.map((u) => `· ${stripOrchestratorServiceUri(u)}`),
    );
  }
  return lines.join('\n');
}

const ORCHESTRATOR_TABLE_HEADER_DESCRIPTION: Record<OrchestratorSortCol, string> = {
  uri:
    'Service URI(s) registered for this orchestrator address. Rows merge multiple URIs under one address; Explorer links use the on-chain orchestrator address.',
  knownSessions: 'Known demand sessions attributed to this orchestrator in the merged registry snapshot.',
  successRatio:
    'Startup success ratio for this orchestrator: successful startup sessions versus sessions requested, as reported upstream for the snapshot window.',
  effectiveSuccessRate:
    'End-to-end effective success rate when reported by upstream data. Null when the field is not available for this row.',
  slaScore: 'SLA score from orchestrator inventory when present; higher is better. Null when not reported.',
  gpuCount: 'Total GPUs advertised across all service URIs grouped under this orchestrator address.',
};

const ORCHESTRATOR_MODELS_HEADER_DESCRIPTION =
  'Pipelines and models this orchestrator advertises. Model tags aggregate per address when the same address exposes multiple URIs.';

function OrchestratorSortTH(props: {
  col: OrchestratorSortCol;
  label: string;
  description: string;
  right?: boolean;
  className?: string;
  activeSortCol: OrchestratorSortCol;
  sortDir: 'asc' | 'desc';
  onToggle: (col: OrchestratorSortCol) => void;
}) {
  const { col, label, description, right, className = '', activeSortCol, sortDir, onToggle } = props;
  const { tipAnchor, tipOpen, triggerProps } = useOverviewPortaledDefinitionTooltip<HTMLButtonElement>();
  const ariaSort: 'ascending' | 'descending' | 'none' =
    activeSortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';
  const Icon =
    activeSortCol !== col ? (
      <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" />
    ) : sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3 shrink-0" />
    ) : (
      <ChevronDown className="w-3 h-3 shrink-0" />
    );
  const labelEl = (
    <span className="cursor-default border-b border-dotted border-border/60" aria-label={description}>
      {label}
    </span>
  );
  return (
    <th className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`.trim()} aria-sort={ariaSort}>
      <div className={`flex w-full min-w-0 items-center gap-0.5 ${right ? 'justify-end' : 'justify-start'}`}>
        <button
          type="button"
          {...triggerProps}
          onClick={() => onToggle(col)}
          className={`inline-flex min-w-0 flex-1 items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse justify-end' : 'justify-start'}`}
          aria-label={`Sort by ${label}`}
        >
          {right ? (
            <>
              {Icon}
              {labelEl}
            </>
          ) : (
            <>
              {labelEl}
              {Icon}
            </>
          )}
        </button>
        {tipOpen && tipAnchor ? (
          <OverviewDefinitionTooltipPortal anchor={tipAnchor}>
            <p>{description}</p>
          </OverviewDefinitionTooltipPortal>
        ) : null}
      </div>
    </th>
  );
}

function OrchestratorModelsHeader(props: { label: string; description: string }) {
  const { label, description } = props;
  const { tipAnchor, tipOpen, triggerProps } = useOverviewPortaledDefinitionTooltip<HTMLButtonElement>();
  return (
    <th className="pb-2 pl-2 font-medium text-left align-bottom">
      <button
        type="button"
        {...triggerProps}
        className="cursor-default rounded-sm border-b border-dotted border-border/60 bg-transparent p-0 text-left font-inherit text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={description}
      >
        {label}
      </button>
      {tipOpen && tipAnchor ? (
        <OverviewDefinitionTooltipPortal anchor={tipAnchor}>
          <p>{description}</p>
        </OverviewDefinitionTooltipPortal>
      ) : null}
    </th>
  );
}

function OrchestratorTableCard({
  data,
  catalog,
  pricing,
}: {
  data: DashboardOrchestrator[];
  catalog?: DashboardPipelineCatalogEntry[] | null;
  pricing: DashboardPipelinePricing[];
}) {
  const [sortCol, setSortCol] = useState<OrchestratorSortCol>('gpuCount');
  const formatURI = (uri?: string) => {
    if (!uri) return '—';
    return stripOrchestratorServiceUri(uri);
  };
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const { copiedId, copyToClipboard } = useClipboardFlash();

  const toggleSort = (col: OrchestratorSortCol) => {
    if (sortCol === col) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortCol(col); setSortDir('desc'); }
  };

  const mergedByAddress = useMemo(() => mergeOrchestratorRowsByAddress([...data]), [data]);

  const sorted = useMemo(() => {
    let rows = [...mergedByAddress];
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
  }, [mergedByAddress, sortCol, sortDir, filter, catalog]);

  const totalGPUsInList = useMemo(() => sorted.reduce((sum, r) => sum + (r.gpuCount ?? 0), 0), [sorted]);
  /** Sum of service URIs across rows — equals the number of `(Address, URI)` pairs from the registry. */
  const totalPairsInList = useMemo(
    () => sorted.reduce((sum, r) => sum + r.uris.length, 0),
    [sorted],
  );
  const totalPairsAll = useMemo(
    () => mergedByAddress.reduce((sum, r) => sum + r.uris.length, 0),
    [mergedByAddress],
  );

  const pricingByKey = useMemo(
    () => new Map(pricing.map((p) => [`${p.pipeline}:${p.model ?? ''}`, p])),
    [pricing],
  );

  return (
    <div className="p-3 rounded-lg bg-card border border-border min-w-0 sm:p-4">
      <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0"><Server className="w-3.5 h-3.5" /></div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-snug sm:text-[11px]">
            Orchestrators ({totalPairsInList}{filter ? ` of ${totalPairsAll}` : ''}) · {totalGPUsInList} GPUs
          </span>
        </div>
        <input
          id="orchestrator-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter URI / pipeline…"
          aria-label="Filter orchestrators by URI, address, or pipeline"
          className="w-full min-w-0 px-2 py-1.5 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground sm:max-w-xs sm:py-0.5"
        />
      </div>
      <div className="max-h-[min(70vh,640px)] min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground border-b border-border">
            <tr>
              <OrchestratorSortTH
                col="uri"
                label="URI"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.uri}
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorSortTH
                col="knownSessions"
                label="Sessions"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.knownSessions}
                right
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorSortTH
                col="successRatio"
                label="Startup %"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.successRatio}
                right
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorSortTH
                col="effectiveSuccessRate"
                label="Effective %"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.effectiveSuccessRate}
                right
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorSortTH
                col="slaScore"
                label="SLA"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.slaScore}
                right
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorSortTH
                col="gpuCount"
                label="GPUs"
                description={ORCHESTRATOR_TABLE_HEADER_DESCRIPTION.gpuCount}
                right
                className="pr-5"
                activeSortCol={sortCol}
                sortDir={sortDir}
                onToggle={toggleSort}
              />
              <OrchestratorModelsHeader label="Models" description={ORCHESTRATOR_MODELS_HEADER_DESCRIPTION} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const explorerHref = livepeerOrchestratingExplorerHref(row.address);
              return (
              <tr key={row.stableRowKey} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
                <td
                  className="py-1.5 min-w-0 align-top"
                  title={row.uris.length ? row.uris.map(stripOrchestratorServiceUri).join('\n') : undefined}
                >
                  <div className="flex min-w-0 w-full flex-col gap-1">
                    {row.uris.length > 0 ? (
                      row.uris.map((uri, i) => {
                        const label = formatURI(uri);
                        return (
                          <div
                            key={`${row.stableRowKey}:uri:${i}`}
                            className="flex w-full min-w-0 items-center justify-start gap-1"
                          >
                            {explorerHref ? (
                              <a
                                href={explorerHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 max-w-[calc(100%-2rem)] shrink truncate font-mono text-foreground underline-offset-2 hover:text-primary hover:underline"
                                title={`${stripOrchestratorServiceUri(uri)} — Livepeer Explorer (orchestrating)`}
                                aria-label={`${label}: view orchestrator on Livepeer Explorer (opens in new tab)`}
                              >
                                {label}
                              </a>
                            ) : (
                              <span
                                className="min-w-0 max-w-[calc(100%-2rem)] shrink truncate font-mono text-foreground"
                                title={stripOrchestratorServiceUri(uri)}
                              >
                                {label}
                              </span>
                            )}
                            <PipelineTableCopyButton
                              inline
                              copied={copiedId === `orch:${row.stableRowKey}:uri:${i}`}
                              onCopy={() => copyToClipboard(`orch:${row.stableRowKey}:uri:${i}`, uri)}
                              title="Copy this service URI"
                              ariaLabel={`Copy service URI ${uri}`}
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {explorerHref ? (
                          <a
                            href={explorerHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                            aria-label="View orchestrator on Livepeer Explorer (opens in new tab)"
                          >
                            Livepeer Explorer
                          </a>
                        ) : (
                          <span className="font-mono text-muted-foreground">—</span>
                        )}
                        {row.address ? (
                          <PipelineTableCopyButton
                            inline
                            copied={copiedId === `orch:${row.stableRowKey}:addr`}
                            onCopy={() => copyToClipboard(`orch:${row.stableRowKey}:addr`, row.address)}
                            title="Copy orchestrator address"
                            ariaLabel={`Copy address ${row.address}`}
                          />
                        ) : null}
                      </div>
                    )}
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
                          <span
                            key={`${p}:${modelId}`}
                            className={`inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium ${modelBadgeColor(modelId, p)}`}
                            title={orchestratorModelTagTooltip(pipelineName, modelId, row.uris, {
                              lastSeen: row.lastSeen,
                              pricing: pricingByKey.get(`${p}:${modelId}`),
                            })}
                          >
                            <span className="truncate">{modelId}</span>
                          </span>
                        ))
                      ) : (
                        <span
                          key={p}
                          className="inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
                          title={orchestratorModelTagTooltip(pipelineName, '—', row.uris, {
                            lastSeen: row.lastSeen,
                            pricing: undefined,
                          })}
                        >
                          —
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
              );
            })}
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
    <div className="flex flex-wrap items-center gap-0.5 px-1 py-0.5 rounded-md bg-muted/30 border border-border">
      <Timer className="w-3 h-3 text-muted-foreground ml-1" />
      {JOB_FEED_POLL_OPTIONS.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)} className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors duration-100 ${value === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{opt.label}</button>
      ))}
    </div>
  );
}

function TimeframeSelector({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const parsedHours = Number.parseInt(value, 10);
  const selected =
    OVERVIEW_TIMEFRAME_OPTIONS.find((o) => o.value === value)
    ?? {
      label: formatOverviewTimeframeLabel(Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 12),
      value,
      description: `Last ${Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 12} hours`,
    };

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
        <div className="absolute left-0 sm:left-auto sm:right-0 mt-1 w-40 max-w-[calc(100vw-2rem)] rounded-md bg-card border border-border shadow-lg z-50" role="listbox">
          {OVERVIEW_TIMEFRAME_OPTIONS.map((opt) => (
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
    <div className="flex flex-col gap-3 min-w-0 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <h1 className="text-base font-semibold text-foreground sm:text-lg">Network Platform</h1>
        <p className="text-[13px] text-muted-foreground">Overview</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
    isPublic, kpi, pipelines, pipelineCatalog, orchestrators, orchestratorsLoading, protocol,
    gpuCapacity, pricing, fees, jobs, jobFeedConnected, jobFeedPollInterval,
    onJobFeedPollIntervalChange, jobFeedMeta, jobFeedError, jobFeedLoading, timeframe,
    onTimeframeChange, lbLoading, rtLoading, feesLoading, lbRefreshing,
    rtRefreshing, feesRefreshing, lbError, rtError, feesError, prefsReady,
  } = props;

  // Supplementary REST enrichment (capacity, live-video, perf-by-model)
  const [netCapacity, setNetCapacity] = useState<Record<string, number>>({});
  const [liveVideoCapacity, setLiveVideoCapacity] = useState<Record<string, number>>({});
  const [modelFpsByPipelineModel, setModelFpsByPipelineModel] = useState<Record<string, number>>({});
  const [pipelineEthUsdSpot, setPipelineEthUsdSpot] = useState<number | null>(null);
  const lastFetchedNetCapacityKeyRef = useRef<string | null>(null);
  const liveVideoCapacityModelsRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/dashboard/eth-usd')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ethUsd?: number } | null) => {
        const n = body?.ethUsd;
        if (cancelled || n == null || !Number.isFinite(n) || n <= 0) return;
        setPipelineEthUsdSpot(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  const uiOrchestratorsLoading = (orchestratorsLoading ?? lbLoading) || !prefsReady;

  const pipelineTableEthUsd = pipelineEthUsdSpot ?? PIPELINE_ETH_USD_CLIENT_FALLBACK;

  return (
    <div className="mx-auto min-w-0 w-full max-w-[1440px] space-y-4 sm:space-y-6">
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
        <div className="grid grid-cols-1 gap-3 items-stretch min-h-0 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:min-h-[min(560px,82vh)] [&>*]:min-h-0">
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
                ethUsdOracle={pipelineTableEthUsd}
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
          <RefreshWrap refreshing={orchestratorsLoading ?? lbRefreshing} className="block min-h-0">
            <OrchestratorTableCard data={orchestrators} catalog={pipelineCatalog} pricing={pricing} />
          </RefreshWrap>
        ) : uiOrchestratorsLoading ? (
          <WidgetSkeleton className="h-[320px]" />
        ) : (
          <WidgetUnavailable label="Orchestrators" />
        )}
      </section>
    </div>
  );
}
