/**
 * Dashboard Provider — Livepeer Leaderboard
 *
 * Registers as the dashboard data provider via createDashboardProvider().
 * Resolvers that have a real data source call the leaderboard API directly;
 * resolvers without one (protocol, fees, pricing) fall back to static values
 * until the appropriate endpoints exist.
 *
 * Real data sources (Phase 1):
 *   kpi.successRate        ← /api/network/demand  (weighted success_ratio, delta vs prev window)
 *   kpi.orchestratorsOnline← /api/sla/compliance  (distinct addresses, latest vs prev hour)
 *   kpi.dailyUsageMins     ← /api/network/demand  (sum total_inference_minutes, 24 h)
 *   kpi.dailyStreamCount   ← /api/network/demand  (sum total_streams, 24 h)
 *   pipelines              ← /api/network/demand  (grouped by pipeline, 24 h)
 *   gpuCapacity.totalGPUs  ← /api/gpu/metrics     (distinct gpu_id, last 1 h)
 *
 * Static fallbacks (no source yet):
 *   protocol   — Livepeer protocol subgraph not wired up
 *   fees       — fee_payment_eth is 0 in the current test network
 *   pricing    — no pricing endpoint exists
 */

import {
  createDashboardProvider,
  type IEventBus,
  type DashboardKPI,
  type DashboardPipelineUsage,
  type DashboardGPUCapacity,
} from '@naap/plugin-sdk';

import {
  fetchNetworkDemand,
  fetchGPUMetrics,
  fetchSLACompliance,
  type NetworkDemandRow,
  type SLAComplianceRow,
} from './api/leaderboard.js';
import { mockProtocol } from './data/mock-protocol.js';
import { mockFees }    from './data/mock-fees.js';
import { mockPricing } from './data/mock-pricing.js';
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
 * Sessions with 0 known_sessions don't contribute.
 * Returns value in [0, 1].
 */
function weightedSuccessRatio(rows: Array<{ success_ratio: number; known_sessions: number }>): number {
  const totalSessions = rows.reduce((s, r) => s + r.known_sessions, 0);
  if (totalSessions === 0) return 1;
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
  // Fetch all three sources in parallel
  // interval=1h  → last 12 h at 1 h resolution  (success rate, hourly delta)
  // interval=2h  → last 24 h at 2 h resolution  (daily usage & streams)
  const [demand1h, demand24h, gpuRows, slaRows] = await Promise.all([
    fetchNetworkDemand('1h'),
    fetchNetworkDemand('2h'),
    fetchGPUMetrics('1h'),
    fetchSLACompliance('24h'),
  ]);

  // --- Success Rate: compare latest 1 h window vs the previous one ---
  const demandWindows = byWindow<NetworkDemandRow>(demand1h);
  const demandKeys    = sortedKeys(demandWindows);

  const latestDemand = demandWindows.get(demandKeys.at(-1) ?? '') ?? [];
  const prevDemand   = demandWindows.get(demandKeys.at(-2) ?? '') ?? [];

  const currentSR = weightedSuccessRatio(latestDemand) * 100;
  const prevSR    = weightedSuccessRatio(prevDemand)   * 100;

  // --- Orchestrators Online: distinct addresses in latest SLA hour vs previous ---
  const slaWindows = byWindow<SLAComplianceRow>(slaRows);
  const slaKeys    = sortedKeys(slaWindows);

  const latestSLA = slaWindows.get(slaKeys.at(-1) ?? '') ?? [];
  const prevSLA   = slaWindows.get(slaKeys.at(-2) ?? '') ?? [];

  // Fall back to GPU metric row count if SLA has no data yet
  const orchCount = countOrchestrators(latestSLA) || gpuRows.length;
  const orchDelta = countOrchestrators(latestSLA) - countOrchestrators(prevSLA);

  // --- Daily Usage & Streams: sum over the last 24 h window ---
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
  // interval=2h → last 24 h; aggregate inference minutes per pipeline
  const demand = await fetchNetworkDemand('2h');

  const totals = new Map<string, number>();
  for (const row of demand) {
    totals.set(row.pipeline, (totals.get(row.pipeline) ?? 0) + row.total_inference_minutes);
  }

  return [...totals.entries()]
    .filter(([name]) => PIPELINE_DISPLAY[name] !== null)   // drop excluded pipelines
    .map(([name, mins]) => ({
      name:  PIPELINE_DISPLAY[name] ?? name,
      mins:  Math.round(mins),
      color: PIPELINE_COLOR[name] ?? DEFAULT_PIPELINE_COLOR,
    }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

async function resolveGPUCapacity(): Promise<DashboardGPUCapacity> {
  const metrics = await fetchGPUMetrics('1h');

  // Total = distinct GPU IDs reporting in the last hour
  const gpuIds   = new Set(metrics.map(m => m.gpu_id).filter(Boolean));
  const totalGPUs = gpuIds.size || metrics.length;

  // Available capacity proxy: avg(1 - failure_rate) across all active GPU rows.
  // When failure_rate = 0 the GPU is fully healthy / available for work.
  const avgAvailable = metrics.length > 0
    ? Math.round(
        (1 - metrics.reduce((s, m) => s + m.failure_rate, 0) / metrics.length) * 100
      )
    : 100;

  return { totalGPUs, availableCapacity: avgAvailable };
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
export function registerMockDashboardProvider(eventBus: IEventBus): () => void {
  return createDashboardProvider(eventBus, {
    // --- Real data ---
    kpi:         () => resolveKPI(),
    pipelines:   ({ limit }) => resolvePipelines({ limit }),
    gpuCapacity: () => resolveGPUCapacity(),

    // --- Static fallbacks (no source yet) ---
    protocol: async () => mockProtocol,  // needs Livepeer protocol subgraph
    fees:     async () => mockFees,      // fee_payment_eth is 0 on test network
    pricing:  async () => mockPricing,   // no pricing endpoint exists
  });
}
