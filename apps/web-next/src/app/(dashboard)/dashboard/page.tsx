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
import { useJobFeedStream } from '@/hooks/useJobFeedStream';
import type {
  DashboardData,
  DashboardKPI,
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

// ============================================================================
// GraphQL Query — the ONLY place data requirements are declared
// ============================================================================

const NETWORK_OVERVIEW_QUERY = /* GraphQL */ `
  query NetworkOverview($timeframe: String) {
    kpi(timeframe: $timeframe) {
      successRate { value delta }
      orchestratorsOnline { value delta }
      dailyUsageMins { value delta }
      dailyStreamCount { value delta }
      timeframeHours
    }
    protocol {
      currentRound
      blockProgress
      totalBlocks
      totalStakedLPT
    }
    pipelines(limit: 50, timeframe: $timeframe) {
      name mins color modelMins { model mins }
    }
    pipelineCatalog {
      id name models
    }
    gpuCapacity {
      totalGPUs
      availableCapacity
      models { model count }
    }
    pricing {
      pipeline unit price outputPerDollar
    }
    orchestrators(period: $timeframe) {
      address knownSessions successSessions successRatio noSwapRatio slaScore pipelines pipelineModels { pipelineId modelIds } gpuCount
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
  action,
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
}) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border hover:border-border/80 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1 rounded-md ${iconColor}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {action && <div className="ml-auto">{action}</div>}
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

function formatTimeframeLabel(hours: number): string {
  if (hours === 1) return '1h';
  if (hours === 72) return '3d';
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
      />
      <KPICard
        icon={Radio}
        iconColor="bg-muted text-muted-foreground"
        label={`Streams (${tfLabel})`}
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
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-start justify-between mb-3">
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
    <div className="p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 rounded-md bg-muted text-muted-foreground">
          <Activity className="w-3.5 h-3.5" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Pipelines ({formatTimeframeLabel(timeframeHours)})
        </span>
      </div>
      <div className="space-y-3">
        {activePipelines.map((p) => (
          <div key={p.name} className="rounded border border-border/60 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-muted/20">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color ?? '#8b5cf6', opacity: 0.9 }}
                  aria-hidden="true"
                />
                <div className="text-xs font-medium text-foreground truncate" title={p.name}>
                  {p.name}
                </div>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{formatNumber(p.mins)} mins</span>
            </div>
            {p.modelMins && p.modelMins.length > 0 ? (
              <div className="px-2 py-1 space-y-0.5 border-t border-border/40">
                {p.modelMins.map((m) => (
                  <div key={m.model} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground pr-2 font-mono break-all">
                      {m.model}
                    </span>
                    <span className="font-mono text-foreground flex-shrink-0">{formatNumber(m.mins)}</span>
                  </div>
                ))}
              </div>
            ) : p.models && p.models.length > 0 ? (
              <div className="px-2 py-1 space-y-0.5 border-t border-border/40">
                {p.models.map((model) => (
                  <div key={model} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground pr-2 font-mono break-all">
                      {model}
                    </span>
                    <span className="font-mono text-muted-foreground/50 flex-shrink-0">—</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {availablePipelines.length > 0 && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setAvailableExpanded((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-muted-foreground transition-colors group"
              aria-expanded={availableExpanded}
            >
              <span>Available (no usage in timeframe)</span>
              <span className="transition-transform group-hover:opacity-100">
                {availableExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </span>
            </button>
            {availableExpanded && (
              <div className="space-y-1.5 mt-1.5">
                {availablePipelines.map((p) => (
                  <div key={p.name} className="rounded border border-border/60 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-muted/20">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: p.color ?? '#6366f1', opacity: 0.9 }}
                          aria-hidden="true"
                        />
                        <div className="text-xs font-medium text-foreground truncate" title={p.name}>
                          {p.name}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">0 mins</span>
                    </div>
                    {p.models && p.models.length > 0 && (
                      <div className="px-2 py-1 space-y-0.5 border-t border-border/40">
                        {p.models.map((model) => (
                          <div key={model} className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground pr-2 font-mono break-all">
                              {model}
                            </span>
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
    </div>
  );
}

const GPU_MODEL_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
];

function GPUCapacityCard({ data }: { data: DashboardGPUCapacity }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (data.availableCapacity / 100) * circumference;
  const totalGPUs = data.totalGPUs || 1;

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
        </div>
      </div>
      {data.models && data.models.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">Capacity by model</div>
          <div
            className="flex h-2 rounded-full overflow-hidden bg-muted/50"
            role="img"
            aria-label="GPU capacity breakdown by model"
          >
            {data.models.map((m, i) => {
              const pct = (m.count / totalGPUs) * 100;
              const color = GPU_MODEL_COLORS[i % GPU_MODEL_COLORS.length];
              return (
                <div
                  key={m.model}
                  className="transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                  }}
                  title={`${m.model}: ${m.count} GPU${m.count !== 1 ? 's' : ''} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="space-y-1.5 mt-2">
            {data.models.map((m, i) => {
              const color = GPU_MODEL_COLORS[i % GPU_MODEL_COLORS.length];
              return (
                <div key={m.model} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground truncate" title={m.model}>{m.model}</span>
                  </span>
                  <span className="font-mono text-foreground flex-shrink-0">{m.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <span className="text-xs text-muted-foreground">Coming soon</span>
            <span className="text-[10px] text-muted-foreground/70 mt-1">Real-time job feed when data is connected</span>
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
// Orchestrator Table Card
// ============================================================================

type OrchestratorSortCol = 'address' | 'knownSessions' | 'successRatio' | 'slaScore' | 'gpuCount';
type SortDir = 'asc' | 'desc';

const LIVE_VIDEO_TO_VIDEO_PIPELINE_ID = 'live-video-to-video';

/** Badge color classes (bg + text) for model badges — high contrast for readability */
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
  const getPipelineLabel = (pipelineId: string, modelIds: string[] | undefined) =>
    formatPipelineLabel(pipelineId, catalog, modelIds);

  const ariaSortValue = (col: OrchestratorSortCol): 'ascending' | 'descending' | 'none' =>
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const TH = ({ col, label, right }: { col: OrchestratorSortCol; label: string; right?: boolean }) => (
    <th className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={ariaSortValue(col)}>
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
              <TH col="successRatio" label="Success %" right />
              <TH col="slaScore" label="SLA" right />
              <TH col="gpuCount" label="GPUs" right />
              <th className="pb-2 font-medium text-left">Pipelines</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.address} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                <td className="py-1.5 font-mono text-foreground">{row.address.slice(0, 8)}…{row.address.slice(-4)}</td>
                <td className="py-1.5 text-right font-mono">{row.knownSessions.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono">{row.successRatio}%</td>
                <td className="py-1.5 text-right font-mono">{row.slaScore ?? '—'}</td>
                <td className="py-1.5 text-right font-mono">{row.gpuCount}</td>
                <td className="py-1.5 max-w-[280px]" title={row.pipelines.map((p) => getPipelineLabel(p, row.pipelineModels?.find((o) => o.pipelineId === p)?.modelIds)).join(', ')}>
                  <div className="flex flex-wrap gap-1">
                    {row.pipelines.length === 0 && '—'}
                    {row.pipelines.map((p) => {
                      const offer = row.pipelineModels?.find((o) => o.pipelineId === p);
                      const modelIds = offer?.modelIds ?? [];
                      const entry = catalog?.find((c) => c.id === p);
                      const pipelineName = entry?.name ?? p;
                      const isLiveV2V = p === LIVE_VIDEO_TO_VIDEO_PIPELINE_ID;
                      return (
                        <span key={p} className="inline-flex flex-wrap gap-1 items-center">
                          {!isLiveV2V && (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                              {pipelineName}
                            </span>
                          )}
                          {modelIds.length > 0 ? (
                            modelIds.map((modelId) => (
                              <span
                                key={modelId}
                                className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${modelBadgeColor(modelId)}`}
                              >
                                {modelId}
                              </span>
                            ))
                          ) : (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                              —
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
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
// Timeframe Selector
// ============================================================================

const TIMEFRAME_KEY = 'naap_dashboard_timeframe';
const DEFAULT_TIMEFRAME = '24';

const TIMEFRAME_OPTIONS = [
  { label: '1h',  value: '1',  description: 'Last hour' },
  { label: '6h',  value: '6',  description: 'Last 6 hours' },
  { label: '12h', value: '12', description: 'Last 12 hours' },
  { label: '24h', value: '24', description: 'Last 24 hours' },
  { label: '72h', value: '72', description: 'Last 3 days' },
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
  const selected = TIMEFRAME_OPTIONS.find((o) => o.value === value) ?? TIMEFRAME_OPTIONS[3];

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

  const [pollInterval, setPollInterval] = useState(getStoredPollInterval);
  const [timeframe, setTimeframe] = useState(getStoredTimeframe);

  const handlePollIntervalChange = (ms: number) => {
    setPollInterval(ms);
    localStorage.setItem(POLL_INTERVAL_KEY, String(ms));
  };

  const handleTimeframeChange = (tf: string) => {
    setTimeframe(tf);
    localStorage.setItem(TIMEFRAME_KEY, tf);
  };

  const { data, loading, error } = useDashboardQuery<DashboardData>(
    NETWORK_OVERVIEW_QUERY,
    { timeframe },
    { pollInterval, timeout: 8000 }
  );
  const { data: feesData, loading: feesLoading } = useDashboardQuery<Pick<DashboardData, 'fees'>>(
    FEES_OVERVIEW_QUERY,
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
      <div className="space-y-6 max-w-[1440px] mx-auto">
        <DashboardHeader pollInterval={pollInterval} onPollIntervalChange={handlePollIntervalChange} />
        <NoProviderMessage />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      <DashboardHeader pollInterval={pollInterval} onPollIntervalChange={handlePollIntervalChange} />

      {/* Protocol & Fees — Subgraph data (timeframe does not apply) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Protocol & Fees</h2>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {data?.protocol
            ? <ProtocolCard data={data.protocol} />
            : loading ? <WidgetSkeleton /> : <WidgetUnavailable label="Protocol" />}
          {feesData?.fees
            ? <FeesCard data={feesData.fees} />
            : feesLoading ? <WidgetSkeleton /> : <WidgetUnavailable label="Fees" />}
        </div>
      </section>

      {/* Leaderboard Metrics — API data (timeframe applies) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Network Metrics</h2>
          <TimeframeSelector value={timeframe} onChange={handleTimeframeChange} />
        </div>
        {data?.kpi ? (
          <KPIRow data={data.kpi} />
        ) : loading ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton /><WidgetSkeleton />
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <WidgetUnavailable label="KPI" />
          </div>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {data?.pipelines && data?.kpi
            ? <PipelinesCard data={data.pipelines} catalog={data.pipelineCatalog} timeframeHours={data.kpi.timeframeHours} />
            : <WidgetUnavailable label="Pipelines" />}
          {data?.gpuCapacity ? <GPUCapacityCard data={data.gpuCapacity} /> : <WidgetUnavailable label="GPU Capacity" />}
        </div>
        {data && (
          <OrchestratorTableCard data={data.orchestrators ?? []} catalog={data.pipelineCatalog} />
        )}
      </section>

      {/* Live Feed & Pricing */}
      <section className="space-y-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
          <JobFeedCard jobs={jobs} connected={jobFeedConnected} />
          {data?.pricing ? <PricingCard data={data.pricing} /> : <WidgetUnavailable label="Pricing" />}
        </div>
      </section>
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
