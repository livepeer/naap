/**
 * Dashboard Provider — Livepeer Leaderboard
 *
 * Registers as the dashboard data provider via createDashboardProvider().
 *
 * Live data sources:
 *   kpi.successRate         ← Leaderboard /api/network/demand  (weighted effective_success_rate)
 *   kpi.orchestratorsOnline ← Leaderboard /api/sla/compliance  (distinct addresses, 72 h)
 *   kpi.dailyUsageMins      ← Leaderboard /api/network/demand  (sum total_minutes, 24 h)
 *   kpi.dailySessionCount   ← Leaderboard /api/network/demand  (sum sessions_count, 24 h)
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
  type RawNetworkDemandRow,
  type RawGPUMetricRow,
  type RawSLAComplianceRow,
  type NetworkDemandFilters,
  type GPUMetricsFilters,
  type SLAComplianceFilters,
} from '@naap/plugin-sdk';

import {
  fetchNetworkDemand,
  fetchGPUMetrics,
  fetchSLACompliance,
  fetchPipelineCatalog,
  type NetworkDemandRow,
  type GPUMetricRow,
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
 * Weighted average of effective_success_rate by known_sessions_count.
 * Returns 0 when no sessions exist (avoids false 100%).
 */
function weightedSuccessRate(rows: Array<{ effective_success_rate: number; known_sessions_count: number }>): number {
  const totalSessions = rows.reduce((s, r) => s + r.known_sessions_count, 0);
  if (totalSessions === 0) return 0;
  return rows.reduce((s, r) => s + r.effective_success_rate * r.known_sessions_count, 0) / totalSessions;
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

/** Valid overview timeframe options in hours (aligned to network demand API max). */
const VALID_TIMEFRAMES = [1, 6, 12, 24] as const;
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
  // For orchestrators, keep the same cap to avoid implying support beyond demand limits.
  const slaPeriod = `${Math.min(timeframeHours, 24)}h`;

  const [demandRows, slaRows] = await Promise.all([
    fetchNetworkDemand(timeframeHours),
    fetchSLACompliance(slaPeriod),
  ]);

  // Success Rate: compare latest window vs the previous one
  const demandWindows = byWindow<NetworkDemandRow>(demandRows);
  const demandKeys    = sortedKeys(demandWindows);

  const latestDemand = demandWindows.get(demandKeys.at(-1) ?? '') ?? [];
  const prevDemand   = demandWindows.get(demandKeys.at(-2) ?? '') ?? [];

  const currentSR = weightedSuccessRate(latestDemand) * 100;
  const prevSR    = weightedSuccessRate(prevDemand) * 100;

  // Orchestrators Seen: distinct addresses across the selected period
  const orchCount = countOrchestrators(slaRows) || 0;
  const orchDelta = 0;

  // Usage, Streams, and Fees: sum over the selected timeframe
  const totalMins    = demandRows.reduce((s, r) => s + (r.total_minutes || 0), 0);
  const totalStreams = demandRows.reduce((s, r) => s + (r.sessions_count || 0), 0);
  const totalFeesEth = demandRows.reduce((s, r) => s + (r.ticket_face_value_eth || 0), 0);

  return {
    successRate:        { value: round1(currentSR),         delta: round1(currentSR - prevSR) },
    orchestratorsOnline:{ value: orchCount,                  delta: orchDelta },
    dailyUsageMins:     { value: Math.round(totalMins),      delta: 0 },
    dailySessionCount:  { value: totalStreams,               delta: 0 },
    dailyNetworkFeesEth:{ value: round1(totalFeesEth),       delta: 0 },
    timeframeHours,
  };
}

// ---------------------------------------------------------------------------
// Pipelines resolver (GPU counts per pipeline and per pipeline+model from SLA)
// ---------------------------------------------------------------------------

/** Count distinct GPUs per pipeline and per (pipeline, model) from SLA rows with sessions. */
function countGPUsByPipelineFromSLA(rows: SLAComplianceRow[]): Map<string, { total: number; byModel: Map<string, number> }> {
  const byPipeline = new Map<string, { gpuIds: Set<string>; rowsNoGpu: number; byModel: Map<string, { gpuIds: Set<string>; rowsNoGpu: number }> }>();

  for (const row of rows) {
    const knownSessions = row.known_sessions_count ?? 0;
    if (knownSessions <= 0) continue;

    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId || PIPELINE_DISPLAY[pipelineId] === null) continue;

    const modelId = row.model_id?.trim() ?? '';

    if (!byPipeline.has(pipelineId)) {
      byPipeline.set(pipelineId, {
        gpuIds: new Set(),
        rowsNoGpu: 0,
        byModel: new Map(),
      });
    }
    const pipelineAcc = byPipeline.get(pipelineId)!;
    if (!pipelineAcc.byModel.has(modelId)) {
      pipelineAcc.byModel.set(modelId, { gpuIds: new Set(), rowsNoGpu: 0 });
    }
    const modelAcc = pipelineAcc.byModel.get(modelId)!;

    if (row.gpu_id) {
      pipelineAcc.gpuIds.add(row.gpu_id);
      modelAcc.gpuIds.add(row.gpu_id);
    } else {
      pipelineAcc.rowsNoGpu += 1;
      modelAcc.rowsNoGpu += 1;
    }
  }

  const result = new Map<string, { total: number; byModel: Map<string, number> }>();
  for (const [pipelineId, acc] of byPipeline.entries()) {
    const total = acc.gpuIds.size + acc.rowsNoGpu;
    const byModel = new Map<string, number>();
    for (const [modelId, ma] of acc.byModel.entries()) {
      const count = ma.gpuIds.size + ma.rowsNoGpu;
      if (count > 0) byModel.set(modelId || '(no model)', count);
    }
    result.set(pipelineId, { total, byModel });
  }
  return result;
}

async function resolvePipelines({ limit = 5, timeframe }: { limit?: number; timeframe?: string }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
  const timeframeHours = parseTimeframe(timeframe);
  const slaPeriod = `${Math.min(timeframeHours, 24)}h`;
  const slaRows = await fetchSLACompliance(slaPeriod);

  const byPipeline = countGPUsByPipelineFromSLA(slaRows);

  return [...byPipeline.entries()]
    .map(([pipelineId, acc]) => ({
      name:  PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      mins:  acc.total, // deprecated, kept for backward compatibility
      gpus:  acc.total,
      color: PIPELINE_COLOR[pipelineId] ?? DEFAULT_PIPELINE_COLOR,
      modelMins: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, count]) => ({ model, mins: count, gpus: count }))
            .sort((a, b) => b.gpus - a.gpus)
        : undefined,
    }))
    .sort((a, b) => b.gpus - a.gpus)
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
    regions: entry.regions ?? [],
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
    const knownSessions = row.known_sessions_count ?? 0;
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
    fetchSLACompliance('24h'),
    fetchGPUMetrics('24h'),
    fetchGPUMetrics('1h'),
  ]);

  // Total GPUs from SLA (same logic as orchestrator table) so the tile matches the sum of orchestrator GPUs
  const totalGPUs = countTotalGPUsFromSLA(slaRows);

  const sample = metricsRecent.length > 0 ? metricsRecent : metricsWide;
  const avgAvailable = sample.length > 0
    ? Math.round(
        (1 - sample.reduce((s, m) => s + m.startup_unexcused_rate, 0) / sample.length) * 100
      )
    : 100;

  const modelCounts = new Map<string, Set<string>>();
  for (const m of metricsWide) {
    if (!m.gpu_model_name || !m.gpu_id) continue;
    if (!modelCounts.has(m.gpu_model_name)) {
      modelCounts.set(m.gpu_model_name, new Set());
    }
    modelCounts.get(m.gpu_model_name)!.add(m.gpu_id);
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

async function resolveOrchestrators({ period = '24h' }: { period?: string }): Promise<DashboardOrchestrator[]> {
  // Normalize period from query variable (e.g. "24" from $timeframe) to API format "24h"
  const periodHours = period && /^\d+$/.test(period) ? parseInt(period, 10) : NaN;
  const resolvedPeriod = Number.isFinite(periodHours) ? `${Math.min(periodHours, 24)}h` : (period || '24h');
  const rows = await fetchSLACompliance(resolvedPeriod);

  type Accum = {
    knownSessions: number;
    successSessions: number;
    unexcusedSessions: number;
    swappedSessions: number;
    /** Weighted sum for effective_success_rate (numerator for weighted avg). */
    effectiveSuccessWeighted: number;
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
        effectiveSuccessWeighted: 0,
        pipelines: new Set(), pipelineModels: new Map(),
        gpuIds: new Set(), rowsWithoutGpuIdWithSessions: 0,
      });
    }

    const d = byAddress.get(row.orchestrator_address)!;
    const knownSessions = row.known_sessions_count ?? 0;
    d.knownSessions += knownSessions;
    d.successSessions += row.startup_success_sessions ?? 0;
    d.unexcusedSessions += row.startup_unexcused_sessions ?? 0;
    d.swappedSessions += row.total_swapped_sessions ?? 0;
    d.effectiveSuccessWeighted += (row.effective_success_rate ?? 0) * knownSessions;

    if (row.pipeline_id) {
      d.pipelines.add(row.pipeline_id);
      if (knownSessions > 0 && row.model_id?.trim()) {
        if (!d.pipelineModels.has(row.pipeline_id)) d.pipelineModels.set(row.pipeline_id, new Set());
        d.pipelineModels.get(row.pipeline_id)!.add(row.model_id.trim());
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
      const effectiveSuccessRate = d.knownSessions > 0
        ? d.effectiveSuccessWeighted / d.knownSessions
        : null;
      const noSwapRatio = d.knownSessions > 0 ? 1 - (d.swappedSessions / d.knownSessions) : null;
      const slaScore = d.knownSessions > 0 ? (0.7 * successRatio + 0.3 * (noSwapRatio || 0)) * 100 : null;

      const gpuCount = d.gpuIds.size + d.rowsWithoutGpuIdWithSessions;

      const pipelineModels = [...d.pipelineModels.entries()]
        .map(([pipelineId, modelIds]) => ({ pipelineId, modelIds: [...modelIds].sort() }))
        .sort((a, b) => a.pipelineId.localeCompare(b.pipelineId));

      return {
        address,
        knownSessions: d.knownSessions,
        successSessions: d.successSessions,
        successRatio: Math.round(successRatio * 1000) / 10,
        effectiveSuccessRate: effectiveSuccessRate !== null ? Math.round(effectiveSuccessRate * 1000) / 10 : null,
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
// Raw Explorer Resolvers (API-native passthrough)
// ---------------------------------------------------------------------------

/** Transform API snake_case NetworkDemandRow to camelCase RawNetworkDemandRow */
function transformNetworkDemandRow(row: NetworkDemandRow): RawNetworkDemandRow {
  return {
    windowStart: row.window_start,
    gateway: row.gateway,
    region: row.region,
    pipelineId: row.pipeline_id,
    modelId: row.model_id,
    sessionsCount: row.sessions_count,
    totalMinutes: row.total_minutes,
    knownSessionsCount: row.known_sessions_count,
    servedSessions: row.served_sessions,
    unservedSessions: row.unserved_sessions,
    totalDemandSessions: row.total_demand_sessions,
    startupUnexcusedSessions: row.startup_unexcused_sessions,
    confirmedSwappedSessions: row.confirmed_swapped_sessions,
    inferredSwapSessions: row.inferred_swap_sessions,
    totalSwappedSessions: row.total_swapped_sessions,
    sessionsEndingInError: row.sessions_ending_in_error,
    errorStatusSamples: row.error_status_samples,
    healthSignalCoverageRatio: row.health_signal_coverage_ratio,
    startupSuccessRate: row.startup_success_rate,
    effectiveSuccessRate: row.effective_success_rate,
    ticketFaceValueEth: row.ticket_face_value_eth,
  };
}

/** Transform API snake_case GPUMetricRow to camelCase RawGPUMetricRow */
function transformGPUMetricRow(row: GPUMetricRow): RawGPUMetricRow {
  return {
    windowStart: row.window_start,
    orchestratorAddress: row.orchestrator_address,
    pipelineId: row.pipeline_id,
    modelId: row.model_id,
    gpuId: row.gpu_id,
    region: row.region,
    gpuModelName: row.gpu_model_name,
    gpuMemoryBytesTotal: row.gpu_memory_bytes_total,
    runnerVersion: row.runner_version,
    cudaVersion: row.cuda_version,
    avgOutputFps: row.avg_output_fps,
    p95OutputFps: row.p95_output_fps,
    fpsJitterCoefficient: row.fps_jitter_coefficient,
    avgPromptToFirstFrameMs: row.avg_prompt_to_first_frame_ms,
    avgStartupLatencyMs: row.avg_startup_latency_ms,
    avgE2eLatencyMs: row.avg_e2e_latency_ms,
    p95PromptToFirstFrameLatencyMs: row.p95_prompt_to_first_frame_latency_ms,
    p95StartupLatencyMs: row.p95_startup_latency_ms,
    p95E2eLatencyMs: row.p95_e2e_latency_ms,
    promptToFirstFrameSampleCount: row.prompt_to_first_frame_sample_count,
    startupLatencySampleCount: row.startup_latency_sample_count,
    e2eLatencySampleCount: row.e2e_latency_sample_count,
    statusSamples: row.status_samples,
    errorStatusSamples: row.error_status_samples,
    knownSessionsCount: row.known_sessions_count,
    startupSuccessSessions: row.startup_success_sessions,
    startupExcusedSessions: row.startup_excused_sessions,
    startupUnexcusedSessions: row.startup_unexcused_sessions,
    confirmedSwappedSessions: row.confirmed_swapped_sessions,
    inferredSwapSessions: row.inferred_swap_sessions,
    totalSwappedSessions: row.total_swapped_sessions,
    sessionsEndingInError: row.sessions_ending_in_error,
    healthSignalCoverageRatio: row.health_signal_coverage_ratio,
    startupUnexcusedRate: row.startup_unexcused_rate,
    swapRate: row.swap_rate,
  };
}

/** Transform API snake_case SLAComplianceRow to camelCase RawSLAComplianceRow */
function transformSLAComplianceRow(row: SLAComplianceRow): RawSLAComplianceRow {
  return {
    windowStart: row.window_start,
    orchestratorAddress: row.orchestrator_address,
    pipelineId: row.pipeline_id,
    modelId: row.model_id,
    gpuId: row.gpu_id,
    region: row.region,
    knownSessionsCount: row.known_sessions_count,
    startupSuccessSessions: row.startup_success_sessions,
    startupExcusedSessions: row.startup_excused_sessions,
    startupUnexcusedSessions: row.startup_unexcused_sessions,
    confirmedSwappedSessions: row.confirmed_swapped_sessions,
    inferredSwapSessions: row.inferred_swap_sessions,
    totalSwappedSessions: row.total_swapped_sessions,
    sessionsEndingInError: row.sessions_ending_in_error,
    errorStatusSamples: row.error_status_samples,
    healthSignalCoverageRatio: row.health_signal_coverage_ratio,
    startupSuccessRate: row.startup_success_rate,
    effectiveSuccessRate: row.effective_success_rate,
    noSwapRate: row.no_swap_rate,
    slaScore: row.sla_score,
  };
}

async function resolveRawNetworkDemand(args: NetworkDemandFilters): Promise<RawNetworkDemandRow[]> {
  const filters = {
    interval: args.interval,
    gateway: args.gateway,
    region: args.region,
    pipeline_id: args.pipelineId,
    model_id: args.modelId,
  };
  const rows = await fetchNetworkDemand(filters);
  return rows.map(transformNetworkDemandRow);
}

/**
 * Normalize CUDA version for API: many backends store/filter as integer major (e.g. 12).
 * "12.2" / "12.0" / "12" -> "12" to avoid text/int mismatch.
 */
function normalizeCudaVersionForApi(value: string | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const major = parseInt(trimmed, 10);
  if (!Number.isNaN(major) && major >= 0) return String(major);
  return trimmed;
}

async function resolveRawGPUMetrics(args: GPUMetricsFilters): Promise<RawGPUMetricRow[]> {
  const filters = {
    time_range: args.timeRange,
    orchestrator_address: args.orchestratorAddress,
    pipeline_id: args.pipelineId,
    model_id: args.modelId,
    gpu_id: args.gpuId,
    region: args.region,
    gpu_model_name: args.gpuModelName,
    runner_version: args.runnerVersion,
    cuda_version: normalizeCudaVersionForApi(args.cudaVersion),
  };
  const rows = await fetchGPUMetrics(filters);
  return rows.map(transformGPUMetricRow);
}

async function resolveRawSLACompliance(args: SLAComplianceFilters): Promise<RawSLAComplianceRow[]> {
  const filters = {
    period: args.period,
    orchestrator_address: args.orchestratorAddress,
    pipeline_id: args.pipelineId,
    model_id: args.modelId,
    gpu_id: args.gpuId,
    region: args.region,
  };
  const rows = await fetchSLACompliance(filters);
  return rows.map(transformSLAComplianceRow);
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
    // Optimized summary resolvers
    kpi:             ({ timeframe }: { timeframe?: string }) => resolveKPI({ timeframe }),
    protocol:        () => resolveProtocol(),
    fees:            ({ days }: { days?: number }) => resolveFees({ days }),
    pipelines:       ({ limit, timeframe }: { limit?: number; timeframe?: string }) => resolvePipelines({ limit, timeframe }),
    pipelineCatalog: () => resolvePipelineCatalog(),
    gpuCapacity:     () => resolveGPUCapacity(),
    pricing:         async () => [],
    orchestrators:   ({ period }: { period?: string }) => resolveOrchestrators({ period }),
    // Raw explorer resolvers
    networkDemand:   (args: NetworkDemandFilters) => resolveRawNetworkDemand(args),
    gpuMetrics:      (args: GPUMetricsFilters) => resolveRawGPUMetrics(args),
    slaCompliance:   (args: SLAComplianceFilters) => resolveRawSLACompliance(args),
  });
}
