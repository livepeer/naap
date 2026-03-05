/**
 * Dashboard Provider — Livepeer Leaderboard
 *
 * Registers as the dashboard data provider via createDashboardProvider().
 *
 * Live data sources:
 *   kpi.successRate         ← Leaderboard /api/network/demand  (weighted success_ratio)
 *   kpi.orchestratorsOnline ← Leaderboard /api/sla/compliance  (distinct addresses, 72 h)
 *   kpi.dailyUsageMins      ← Leaderboard /api/network/demand  (sum total_inference_minutes, 24 h)
 *   kpi.dailyStreamCount    ← Leaderboard /api/network/demand  (sum total_streams, 24 h)
 *   pipelines               ← Leaderboard /api/network/demand  (grouped by pipeline, 24 h)
 *   gpuCapacity.totalGPUs   ← Leaderboard /api/gpu/metrics     (distinct gpu_id, 24 h)
 *   orchestrators            ← Leaderboard /api/sla/compliance  (per-address aggregation)
 *   protocol                ← Livepeer subgraph + L1 RPC (via server-side proxy routes)
 *   fees                    ← Livepeer subgraph (via server-side proxy route)
 *
 * Static fallback (no source yet):
 *   pricing
 */

import {
  createDashboardProvider,
  type IEventBus,
  type DashboardKPI,
  type DashboardPipelineUsage,
  type DashboardPipelineCatalogEntry,
  type DashboardGPUCapacity,
  type DashboardOrchestrator,
  type DashboardProtocol,
} from '@naap/plugin-sdk';

import {
  fetchNetworkDemand,
  fetchGPUMetrics,
  fetchSLACompliance,
  fetchPipelineCatalog,
  type NetworkDemandRow,
  type SLAComplianceRow,
} from './api/leaderboard.js';
import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from './data/pipeline-config.js';
import { fetchSubgraphFees, fetchSubgraphProtocol } from './api/subgraph.js';

// ---------------------------------------------------------------------------
// Subgraph resolvers (protocol & fees)
// ---------------------------------------------------------------------------

async function fetchCurrentProtocolBlock(): Promise<number> {
  const response = await fetch('/api/v1/protocol-block');
  if (!response.ok) {
    throw new Error(`protocol-block HTTP ${response.status}`);
  }

  const body = (await response.json()) as { blockNumber?: number };
  if (!Number.isFinite(body.blockNumber)) {
    throw new Error('protocol-block returned invalid blockNumber');
  }

  return Number(body.blockNumber);
}

async function resolveProtocol(): Promise<DashboardProtocol> {
  const protocol = await fetchSubgraphProtocol();
  let currentProtocolBlock: number | null = null;
  try {
    currentProtocolBlock = await fetchCurrentProtocolBlock();
  } catch (err) {
    console.warn('[dashboard-data-provider] protocol-block unavailable:', err);
  }

  const rawProgress = protocol.initialized && Number.isFinite(currentProtocolBlock)
    ? Number(currentProtocolBlock) - protocol.startBlock
    : 0;
  const blockProgress = Math.max(0, Math.min(rawProgress, protocol.totalBlocks));

  return {
    currentRound: protocol.currentRound,
    blockProgress,
    totalBlocks: protocol.totalBlocks,
    totalStakedLPT: protocol.totalStakedLPT,
  };
}

async function resolveFees({ days }: { days?: number }) {
  return fetchSubgraphFees(days);
}

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

function trueSuccessRate(rows: NetworkDemandRow[]): number {
  let served = 0, totalDemand = 0, unexcused = 0, known = 0;
  for (const r of rows) {
    served += r.served_sessions || 0;
    totalDemand += r.total_demand_sessions || 0;
    unexcused += r.unexcused_sessions || 0;
    known += r.known_sessions || 0;
  }
  if (totalDemand === 0 || known === 0) return 0;
  return (served / totalDemand) * (1 - unexcused / known) * 100;
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

/** Valid timeframe options in hours */
const VALID_TIMEFRAMES = [1, 6, 12, 24, 72] as const;
type TimeframeHours = (typeof VALID_TIMEFRAMES)[number];

function parseTimeframe(input?: string | number): TimeframeHours {
  const hours = typeof input === 'string' ? parseInt(input, 10) : input;
  if (hours && VALID_TIMEFRAMES.includes(hours as TimeframeHours)) {
    return hours as TimeframeHours;
  }
  return 24; // default
}

async function resolveKPI({ timeframe }: { timeframe?: string }): Promise<DashboardKPI & { timeframeHours: number }> {
  const timeframeHours = parseTimeframe(timeframe);
  
  // Fetch demand data for the selected timeframe
  // For orchestrators, use the same timeframe but cap at 72h for SLA data
  const slaPeriod = `${Math.min(timeframeHours, 72)}h`;
  
  const [demandRows, slaRows] = await Promise.all([
    fetchNetworkDemand(timeframeHours),
    fetchSLACompliance(slaPeriod),
  ]);

  // Success Rate: compare latest window vs the previous one
  const demandWindows = byWindow<NetworkDemandRow>(demandRows);
  const demandKeys    = sortedKeys(demandWindows);

  const latestDemand = demandWindows.get(demandKeys.at(-1) ?? '') ?? [];
  const prevDemand   = demandWindows.get(demandKeys.at(-2) ?? '') ?? [];

  const currentSR = trueSuccessRate(latestDemand);
  const prevSR    = trueSuccessRate(prevDemand);

  // Orchestrators Seen: distinct addresses across the selected period
  const orchCount = countOrchestrators(slaRows) || 0;
  const orchDelta = 0;

  // Usage, Streams, and Fees: sum over the selected timeframe
  const totalMins    = demandRows.reduce((s, r) => s + (r.total_inference_minutes || 0), 0);
  const totalStreams = demandRows.reduce((s, r) => s + (r.total_streams || 0), 0);
  const totalFeesEth = demandRows.reduce((s, r) => s + (r.fee_payment_eth || 0), 0);

  return {
    successRate:        { value: round1(currentSR),         delta: round1(currentSR - prevSR) },
    orchestratorsOnline:{ value: orchCount,                  delta: orchDelta },
    dailyUsageMins:     { value: Math.round(totalMins),      delta: 0 },
    dailyStreamCount:   { value: totalStreams,               delta: 0 },
    dailyNetworkFeesEth:{ value: round1(totalFeesEth),       delta: 0 },
    timeframeHours,
  };
}

// ---------------------------------------------------------------------------
// Pipelines resolver
// ---------------------------------------------------------------------------

async function resolvePipelines({ limit = 5, timeframe }: { limit?: number; timeframe?: string }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  const timeframeHours = parseTimeframe(timeframe);
  const demand = await fetchNetworkDemand(timeframeHours);

  type Accum = { mins: number; modelMins: Map<string, number> };
  const byPipeline = new Map<string, Accum>();

  for (const row of demand) {
    const pipelineName = row.pipeline?.trim();
    if (!pipelineName || PIPELINE_DISPLAY[pipelineName] === null) continue;
    const acc = byPipeline.get(pipelineName) ?? { mins: 0, modelMins: new Map<string, number>() };
    const mins = row.total_inference_minutes ?? 0;
    acc.mins += mins;
    const modelId = row.model_id?.trim();
    if (modelId) {
      acc.modelMins.set(modelId, (acc.modelMins.get(modelId) ?? 0) + mins);
    }
    byPipeline.set(pipelineName, acc);
  }

  return [...byPipeline.entries()]
    .map(([pipeline, acc]) => ({
      name:  PIPELINE_DISPLAY[pipeline] ?? pipeline,
      mins:  Math.round(acc.mins),
      color: PIPELINE_COLOR[pipeline] ?? DEFAULT_PIPELINE_COLOR,
      modelMins: acc.modelMins.size > 0
        ? [...acc.modelMins.entries()]
            .map(([model, m]) => ({ model, mins: Math.round(m) }))
            .sort((a, b) => b.mins - a.mins)
        : undefined,
    }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, safeLimit);
}

// ---------------------------------------------------------------------------
// Pipeline Catalog resolver (all supported pipelines/models on the network)
// ---------------------------------------------------------------------------

async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  const catalog = await fetchPipelineCatalog();

  return catalog.map((entry) => ({
    id: entry.id,
    name: PIPELINE_DISPLAY[entry.id] ?? entry.id,
    models: entry.models ?? [],
  }));
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

/** Count total GPUs from SLA compliance (same source as orchestrators): distinct GPUs with sessions + rows with sessions but no gpu_id. */
function countTotalGPUsFromSLA(rows: SLAComplianceRow[]): number {
  const gpuIds = new Set<string>();
  let rowsWithoutGpuIdWithSessions = 0;
  for (const row of rows) {
    const knownSessions = row.known_sessions ?? 0;
    if (knownSessions <= 0) continue;
    if (row.gpu_id) {
      gpuIds.add(row.gpu_id);
    } else {
      rowsWithoutGpuIdWithSessions += 1;
    }
  }
  return gpuIds.size + rowsWithoutGpuIdWithSessions;
}

async function resolveGPUCapacity(): Promise<DashboardGPUCapacity> {
  const [slaRows, metricsWide, metricsRecent] = await Promise.all([
    fetchSLACompliance('72h'),
    fetchGPUMetrics('24h'),
    fetchGPUMetrics('1h'),
  ]);

  // Total GPUs from SLA (same logic as orchestrator table) so the tile matches the sum of orchestrator GPUs
  const totalGPUs = countTotalGPUsFromSLA(slaRows);

  const sample = metricsRecent.length > 0 ? metricsRecent : metricsWide;
  const avgAvailable = sample.length > 0
    ? Math.round(
        (1 - sample.reduce((s, m) => s + m.failure_rate, 0) / sample.length) * 100
      )
    : 100;

  const modelCounts = new Map<string, Set<string>>();
  for (const m of metricsWide) {
    if (!m.gpu_name || !m.gpu_id) continue;
    if (!modelCounts.has(m.gpu_name)) {
      modelCounts.set(m.gpu_name, new Set());
    }
    modelCounts.get(m.gpu_name)!.add(m.gpu_id);
  }

  const models = [...modelCounts.entries()].map(([model, ids]) => ({
    model,
    count: ids.size,
  })).sort((a, b) => b.count - a.count);

  return { totalGPUs, availableCapacity: avgAvailable, models };
}

// ---------------------------------------------------------------------------
// Orchestrators resolver
// ---------------------------------------------------------------------------

async function resolveOrchestrators({ period = '72h' }: { period?: string }): Promise<DashboardOrchestrator[]> {
  // Normalize period from query variable (e.g. "24" from $timeframe) to API format "24h"
  const periodHours = period && /^\d+$/.test(period) ? parseInt(period, 10) : NaN;
  const resolvedPeriod = Number.isFinite(periodHours) ? `${Math.min(periodHours, 72)}h` : (period || '72h');
  const rows = await fetchSLACompliance(resolvedPeriod);

  type Accum = {
    knownSessions: number;
    successSessions: number;
    unexcusedSessions: number;
    swappedSessions: number;
    pipelines: Set<string>;
    /** Per-pipeline set of model_ids this orchestrator offered (from SLA rows with sessions). */
    pipelineModels: Map<string, Set<string>>;
    /** Distinct GPUs that had sessions in this period (only count rows with known_sessions > 0). */
    gpuIds: Set<string>;
    /** Rows with no gpu_id but with sessions: treat each as one GPU. */
    rowsWithoutGpuIdWithSessions: number;
  };

  const byAddress = new Map<string, Accum>();

  for (const row of rows) {
    if (!row.orchestrator_address?.startsWith('0x')) continue;

    if (!byAddress.has(row.orchestrator_address)) {
      byAddress.set(row.orchestrator_address, {
        knownSessions: 0, successSessions: 0,
        unexcusedSessions: 0, swappedSessions: 0,
        pipelines: new Set(), pipelineModels: new Map(),
        gpuIds: new Set(), rowsWithoutGpuIdWithSessions: 0,
      });
    }

    const d = byAddress.get(row.orchestrator_address)!;
    const knownSessions = row.known_sessions ?? 0;
    d.knownSessions += knownSessions;
    d.successSessions += row.success_sessions ?? 0;
    d.unexcusedSessions += row.unexcused_sessions ?? 0;
    d.swappedSessions += row.swapped_sessions ?? 0;

    if (row.pipeline) {
      d.pipelines.add(row.pipeline);
      if (knownSessions > 0 && row.model_id?.trim()) {
        if (!d.pipelineModels.has(row.pipeline)) d.pipelineModels.set(row.pipeline, new Set());
        d.pipelineModels.get(row.pipeline)!.add(row.model_id.trim());
      }
    }
    // Only count GPUs that had sessions so the number is associated with the session data
    if (knownSessions <= 0) continue;
    if (row.gpu_id) {
      d.gpuIds.add(row.gpu_id);
    } else {
      d.rowsWithoutGpuIdWithSessions += 1;
    }
  }

  return [...byAddress.entries()]
    .map(([address, d]) => {
      const successRatio = d.knownSessions > 0 ? 1 - (d.unexcusedSessions / d.knownSessions) : 0;
      const noSwapRatio = d.knownSessions > 0 ? 1 - (d.swappedSessions / d.knownSessions) : null;
      const slaScore = d.knownSessions > 0 ? (0.7 * successRatio + 0.3 * (noSwapRatio || 0)) * 100 : null;

      // GPU count: distinct GPUs that had sessions in this period (+ rows with sessions but no gpu_id).
      const gpuCount = d.gpuIds.size + d.rowsWithoutGpuIdWithSessions;

      const pipelineModels = [...d.pipelineModels.entries()]
        .map(([pipelineId, modelIds]) => ({ pipelineId, modelIds: [...modelIds].sort() }))
        .sort((a, b) => a.pipelineId.localeCompare(b.pipelineId));

      return {
        address,
        knownSessions: d.knownSessions,
        successSessions: d.successSessions,
        successRatio: Math.round(successRatio * 1000) / 10,
        noSwapRatio: noSwapRatio !== null ? Math.round(noSwapRatio * 1000) / 10 : null,
        slaScore: slaScore !== null ? Math.round(slaScore) : null,
        pipelines: [...d.pipelines].sort(),
        pipelineModels,
        gpuCount,
      };
    })
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
    kpi:             ({ timeframe }: { timeframe?: string }) => resolveKPI({ timeframe }),
    protocol:        () => resolveProtocol(),
    fees:            ({ days }: { days?: number }) => resolveFees({ days }),
    pipelines:       ({ limit, timeframe }: { limit?: number; timeframe?: string }) => resolvePipelines({ limit, timeframe }),
    pipelineCatalog: () => resolvePipelineCatalog(),
    gpuCapacity:     () => resolveGPUCapacity(),
    pricing:         async () => [],
    orchestrators:   ({ period }: { period?: string }) => resolveOrchestrators({ period }),
  });
}
