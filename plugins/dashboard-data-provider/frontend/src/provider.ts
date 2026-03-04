/**
 * Dashboard Provider — Livepeer Leaderboard
 *
 * Registers as the dashboard data provider via createDashboardProvider().
 * Resolvers with a real data source call the Leaderboard API directly;
 * resolvers without one (protocol, fees, pricing) fall back to static
 * values until the appropriate endpoints exist.
 *
 * Real data sources:
 *   kpi.successRate         ← /api/network/demand  (weighted success_ratio)
 *   kpi.orchestratorsOnline ← /api/sla/compliance  (distinct addresses, 72 h)
 *   kpi.dailyUsageMins      ← /api/network/demand  (sum total_inference_minutes, 24 h)
 *   kpi.dailyStreamCount    ← /api/network/demand  (sum total_streams, 24 h)
 *   pipelines               ← /api/network/demand  (grouped by pipeline, 24 h)
 *   gpuCapacity.totalGPUs   ← /api/gpu/metrics     (distinct gpu_id, 24 h)
 *   orchestrators            ← /api/sla/compliance  (per-address aggregation)
 *
 * Static fallbacks (no source yet):
 *   protocol, fees, pricing
 */

import {
  createDashboardProvider,
  type IEventBus,
  type DashboardKPI,
  type DashboardPipelineUsage,
  type DashboardGPUCapacity,
  type DashboardOrchestrator,
} from '@naap/plugin-sdk';

import {
  fetchNetworkDemand,
  fetchGPUMetrics,
  fetchSLACompliance,
  type NetworkDemandRow,
  type SLAComplianceRow,
} from './api/leaderboard.js';
import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from './data/pipeline-config.js';

// ---------------------------------------------------------------------------
// Shared aggregation helpers
// ---------------------------------------------------------------------------

/** Group rows by their window_start ISO string */
function byWindow<T extends { window_start: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const bucket = m.get(r.window_start) ?? [];
    bucket.push(r);
    m.set(r.window_start, bucket);
  }
  return m;
}

/** Sorted window keys (ascending) from a grouped map */
function sortedKeys(m: Map<string, unknown[]>): string[] {
  return [...m.keys()].sort();
}

/**
 * Weighted average of success_ratio by known_sessions.
 * Returns 0 when no sessions exist (avoids false 100%).
 */
function weightedSuccessRatio(rows: Array<{ success_ratio: number; known_sessions: number }>): number {
  const totalSessions = rows.reduce((s, r) => s + r.known_sessions, 0);
  if (totalSessions === 0) return 0;
  return rows.reduce((s, r) => s + r.success_ratio * r.known_sessions, 0) / totalSessions;
}

/** Count distinct non-empty Ethereum addresses in an array of SLA rows */
function countOrchestrators(rows: SLAComplianceRow[]): number {
  return new Set(rows.map(r => r.orchestrator_address).filter(a => a?.startsWith('0x'))).size;
}

/** Round to one decimal place */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// KPI resolver
// ---------------------------------------------------------------------------

async function resolveKPI(): Promise<DashboardKPI> {
  const [demand1h, demand24h, gpuRows, slaRows] = await Promise.all([
    fetchNetworkDemand('1h'),
    fetchNetworkDemand('2h'),
    fetchGPUMetrics('1h'),
    fetchSLACompliance('72h'),
  ]);

  // Success Rate: compare latest 1 h window vs the previous one
  const demandWindows = byWindow<NetworkDemandRow>(demand1h);
  const demandKeys    = sortedKeys(demandWindows);

  const latestDemand = demandWindows.get(demandKeys.at(-1) ?? '') ?? [];
  const prevDemand   = demandWindows.get(demandKeys.at(-2) ?? '') ?? [];

  const currentSR = weightedSuccessRatio(latestDemand) * 100;
  const prevSR    = weightedSuccessRatio(prevDemand)   * 100;

  // Orchestrators Seen (72h): distinct addresses across the full period
  const orchCount = countOrchestrators(slaRows) || gpuRows.length;
  const orchDelta = 0;

  // Daily Usage & Streams: sum over the last 24 h window
  const dailyMins    = demand24h.reduce((s, r) => s + r.total_inference_minutes, 0);
  const dailyStreams  = demand24h.reduce((s, r) => s + r.total_streams, 0);

  return {
    successRate:        { value: round1(currentSR),         delta: round1(currentSR - prevSR) },
    orchestratorsOnline:{ value: orchCount,                  delta: orchDelta },
    dailyUsageMins:     { value: Math.round(dailyMins),      delta: 0 },
    dailyStreamCount:   { value: dailyStreams,                delta: 0 },
  };
}

// ---------------------------------------------------------------------------
// Pipelines resolver
// ---------------------------------------------------------------------------

async function resolvePipelines({ limit = 5 }: { limit?: number }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  const demand = await fetchNetworkDemand('2h');

  const totals = new Map<string, number>();
  for (const row of demand) {
    totals.set(row.pipeline, (totals.get(row.pipeline) ?? 0) + row.total_inference_minutes);
  }

  return [...totals.entries()]
    .filter(([name]) => PIPELINE_DISPLAY[name] !== null)
    .map(([name, mins]) => ({
      name:  PIPELINE_DISPLAY[name] ?? name,
      mins:  Math.round(mins),
      color: PIPELINE_COLOR[name] ?? DEFAULT_PIPELINE_COLOR,
    }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, safeLimit);
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

async function resolveGPUCapacity(): Promise<DashboardGPUCapacity> {
  const [metricsWide, metricsRecent] = await Promise.all([
    fetchGPUMetrics('24h'),
    fetchGPUMetrics('1h'),
  ]);

  const gpuIds    = new Set(metricsWide.map(m => m.gpu_id).filter(Boolean));
  const totalGPUs = gpuIds.size || metricsWide.length;

  const sample = metricsRecent.length > 0 ? metricsRecent : metricsWide;
  const avgAvailable = sample.length > 0
    ? Math.round(
        (1 - sample.reduce((s, m) => s + m.failure_rate, 0) / sample.length) * 100
      )
    : 100;

  return { totalGPUs, availableCapacity: avgAvailable };
}

// ---------------------------------------------------------------------------
// Orchestrators resolver
// ---------------------------------------------------------------------------

async function resolveOrchestrators({ period = '72h' }: { period?: string }): Promise<DashboardOrchestrator[]> {
  const rows = await fetchSLACompliance(period);

  type Accum = {
    knownSessions: number;
    successSessions: number;
    srSum: number;
    srSessions: number;
    slaSum: number;
    slaSessions: number;
    noSwapSum: number;
    noSwapSessions: number;
    pipelines: Set<string>;
    gpuIds: Set<string>;
  };

  const byAddress = new Map<string, Accum>();

  for (const row of rows) {
    if (!row.orchestrator_address?.startsWith('0x')) continue;

    if (!byAddress.has(row.orchestrator_address)) {
      byAddress.set(row.orchestrator_address, {
        knownSessions: 0, successSessions: 0,
        srSum: 0, srSessions: 0,
        slaSum: 0, slaSessions: 0,
        noSwapSum: 0, noSwapSessions: 0,
        pipelines: new Set(), gpuIds: new Set(),
      });
    }

    const d = byAddress.get(row.orchestrator_address)!;
    const knownSessions = row.known_sessions ?? 0;
    d.knownSessions += knownSessions;
    d.successSessions += row.success_sessions ?? 0;

    if (row.success_ratio != null && knownSessions > 0) {
      d.srSum += row.success_ratio * knownSessions;
      d.srSessions += knownSessions;
    }
    if (row.sla_score != null && knownSessions > 0) {
      d.slaSum += row.sla_score * knownSessions;
      d.slaSessions += knownSessions;
    }
    if (row.no_swap_ratio != null && knownSessions > 0) {
      d.noSwapSum += row.no_swap_ratio * knownSessions;
      d.noSwapSessions += knownSessions;
    }
    if (row.pipeline) d.pipelines.add(row.pipeline);
    if (row.gpu_id) d.gpuIds.add(row.gpu_id);
  }

  return [...byAddress.entries()]
    .map(([address, d]) => ({
      address,
      knownSessions: d.knownSessions,
      successSessions: d.successSessions,
      successRatio: d.srSessions > 0
        ? Math.round((d.srSum / d.srSessions) * 1000) / 10
        : 0,
      noSwapRatio: d.noSwapSessions > 0
        ? Math.round((d.noSwapSum / d.noSwapSessions) * 1000) / 10
        : null,
      slaScore: d.slaSessions > 0
        ? Math.round(d.slaSum / d.slaSessions)
        : null,
      pipelines: [...d.pipelines].sort(),
      gpuCount: d.gpuIds.size,
    }))
    .sort((a, b) => b.knownSessions - a.knownSessions);
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

/**
 * Register the leaderboard-backed dashboard provider on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerDashboardProvider(eventBus: IEventBus): () => void {
  return createDashboardProvider(eventBus, {
    kpi:           () => resolveKPI(),
    pipelines:     ({ limit }: { limit?: number }) => resolvePipelines({ limit }),
    gpuCapacity:   () => resolveGPUCapacity(),
    orchestrators: ({ period }: { period?: string }) => resolveOrchestrators({ period }),

    protocol: async () => ({
      currentRound: 0,
      blockProgress: 0,
      totalBlocks: 5760,
      totalStakedLPT: 0,
    }),
    fees: async () => ({
      totalEth: 0,
      entries: [],
    }),
    pricing: async () => [],
  });
}
