/**
 * Dashboard Provider — Livepeer Leaderboard
 *
 * Registers as the dashboard data provider via createDashboardProvider().
 *
 * Live data sources:
 *   kpi.successRate         ← Leaderboard /api/network/demand  (served_sessions / total_demand_sessions)
 *   kpi.orchestratorsOnline ← Leaderboard /api/sla/compliance  (distinct addresses, 72 h)
 *   kpi.dailyUsageMins      ← Leaderboard /api/network/demand  (sum total_minutes, 24 h)
 *   kpi.dailySessionCount   ← Leaderboard /api/network/demand  (sum total_demand_sessions, 24 h)
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

/**
 * Demand-served rate: served_sessions / total_demand_sessions across rows.
 * Uses demand API fields for real session counts (served vs unserved).
 * Returns 0 when no demand exists.
 */
function demandServedRate(rows: Array<{ served_sessions: number; total_demand_sessions: number }>): number {
  const totalDemand = rows.reduce((s, r) => s + (r.total_demand_sessions ?? 0), 0);
  if (totalDemand === 0) return 0;
  const served = rows.reduce((s, r) => s + (r.served_sessions ?? 0), 0);
  return served / totalDemand;
}

/** Count distinct non-empty Ethereum addresses in an array of SLA rows */
function countOrchestrators(rows: SLAComplianceRow[]): number {
  return new Set(rows.map(r => r.orchestrator_address).filter(a => a?.startsWith('0x'))).size;
}

/** Round to one decimal place */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const NETWORK_SLA_CACHE_TTL_MS = 30_000;

interface SlaCacheEntry {
  rows: SLAComplianceRow[];
  cachedAtMs: number;
}

const slaCacheByPeriod = new Map<string, SlaCacheEntry>();
const slaInFlightByPeriod = new Map<string, Promise<SLAComplianceRow[]>>();

/**
 * Shared SLA rows keyed by period string (e.g. "168h").
 * Reuses in-flight work and short-TTL cache to avoid duplicate long requests.
 */
async function getSLAComplianceRows(period: string): Promise<SLAComplianceRow[]> {
  const now = Date.now();
  const cached = slaCacheByPeriod.get(period);
  if (cached && now - cached.cachedAtMs < NETWORK_SLA_CACHE_TTL_MS) {
    return cached.rows;
  }

  const inFlight = slaInFlightByPeriod.get(period);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const rows = await fetchSLACompliance({ period });
      slaCacheByPeriod.set(period, { rows, cachedAtMs: Date.now() });
      return rows;
    } catch (err) {
      if (cached) {
        console.warn(`[dashboard-data-provider] SLA refresh (${period}) failed; serving cached rows:`, err);
        return cached.rows;
      }
      throw err;
    } finally {
      slaInFlightByPeriod.delete(period);
    }
  })();

  slaInFlightByPeriod.set(period, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// KPI resolver
// ---------------------------------------------------------------------------

/** Valid overview timeframe options in hours (aligned to SLA compliance API max 720h). */
const VALID_TIMEFRAMES = [24, 168, 336, 720] as const;
type TimeframeHours = (typeof VALID_TIMEFRAMES)[number];

function parseTimeframe(input?: string | number): TimeframeHours {
  const hours = typeof input === 'string' ? parseInt(input, 10) : input;
  if (hours && VALID_TIMEFRAMES.includes(hours as TimeframeHours)) {
    return hours as TimeframeHours;
  }
  return 168; // default 7 days
}

async function resolveKPI({ timeframe }: { timeframe?: string }): Promise<DashboardKPI & { timeframeHours: number }> {
  const timeframeHours = parseTimeframe(timeframe);
  const slaPeriod = `${timeframeHours}h`;

  // Demand API is capped at 24h; SLA uses the full selected timeframe.
  const [demandRows, slaRows] = await Promise.all([
    fetchNetworkDemand(Math.min(timeframeHours, 24)),
    getSLAComplianceRows(slaPeriod),
  ]);

  // Success Rate: served_sessions / total_demand_sessions (demand API has real served vs unserved counts)
  const currentSR = demandServedRate(demandRows) * 100;

  // Orchestrators Seen: distinct addresses across the selected period
  const orchCount = countOrchestrators(slaRows) || 0;
  const orchDelta = 0;

  // Usage, Sessions, Fees: aggregate from demand API (24h max; real served/unserved counts)
  const totalMins    = demandRows.reduce((s, r) => s + (r.total_minutes ?? 0), 0);
  const totalStreams = demandRows.reduce((s, r) => s + (r.total_demand_sessions ?? 0), 0);
  const totalFeesEth = demandRows.reduce((s, r) => s + (r.ticket_face_value_eth || 0), 0);

  return {
    successRate:        { value: round1(currentSR),         delta: 0 },
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

/** Count unique GPU IDs per pipeline and per (pipeline, model) from SLA rows. */
function countGPUsByPipelineFromSLA(rows: SLAComplianceRow[]): Map<string, { total: number; byModel: Map<string, number> }> {
  const byPipeline = new Map<string, { gpuIds: Set<string>; byModel: Map<string, Set<string>> }>();

  for (const row of rows) {
    const gpuId = row.gpu_id?.trim();
    if (!gpuId) continue;

    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId || PIPELINE_DISPLAY[pipelineId] === null) continue;

    const modelId = row.model_id?.trim() ?? '';

    if (!byPipeline.has(pipelineId)) {
      byPipeline.set(pipelineId, { gpuIds: new Set(), byModel: new Map() });
    }
    const pipelineAcc = byPipeline.get(pipelineId)!;
    pipelineAcc.gpuIds.add(gpuId);

    if (!pipelineAcc.byModel.has(modelId)) {
      pipelineAcc.byModel.set(modelId, new Set());
    }
    pipelineAcc.byModel.get(modelId)!.add(gpuId);
  }

  const result = new Map<string, { total: number; byModel: Map<string, number> }>();
  for (const [pipelineId, acc] of byPipeline.entries()) {
    const byModel = new Map<string, number>();
    for (const [modelId, gpuIds] of acc.byModel.entries()) {
      if (gpuIds.size > 0) byModel.set(modelId || '(no model)', gpuIds.size);
    }
    result.set(pipelineId, { total: acc.gpuIds.size, byModel });
  }
  return result;
}

interface PipelineModelAccum {
  mins: number;
  sessions: number;
  fpsWeighted: number;
}

interface PipelineAccum {
  mins: number;
  sessions: number;
  fpsWeighted: number;
  byModel: Map<string, PipelineModelAccum>;
}

async function resolvePipelines({ limit = 5 }: { limit?: number; timeframe?: string }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;

  const demandRows = await fetchNetworkDemand(24);

  const byPipeline = new Map<string, PipelineAccum>();
  for (const row of demandRows) {
    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId || PIPELINE_DISPLAY[pipelineId] === null) continue;
    const mins = row.total_minutes ?? 0;
    const sessionsCt = row.sessions_count ?? 0;
    if (mins <= 0 && sessionsCt <= 0) continue;

    let entry = byPipeline.get(pipelineId);
    if (!entry) {
      entry = { mins: 0, sessions: 0, fpsWeighted: 0, byModel: new Map() };
      byPipeline.set(pipelineId, entry);
    }
    entry.mins += mins;
    entry.sessions += sessionsCt;
    if (sessionsCt > 0) {
      entry.fpsWeighted += (row.avg_output_fps ?? 0) * sessionsCt;
    }

    const modelId = row.model_id?.trim();
    if (modelId) {
      let modelAcc = entry.byModel.get(modelId);
      if (!modelAcc) {
        modelAcc = { mins: 0, sessions: 0, fpsWeighted: 0 };
        entry.byModel.set(modelId, modelAcc);
      }
      modelAcc.mins += mins;
      modelAcc.sessions += sessionsCt;
      if (sessionsCt > 0) {
        modelAcc.fpsWeighted += (row.avg_output_fps ?? 0) * sessionsCt;
      }
    }
  }

  return [...byPipeline.entries()]
    .map(([pipelineId, acc]) => ({
      name:     PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      mins:     Math.round(acc.mins),
      sessions: acc.sessions,
      avgFps:   acc.sessions > 0 ? Math.round((acc.fpsWeighted / acc.sessions) * 10) / 10 : 0,
      gpus:     0,
      color:    PIPELINE_COLOR[pipelineId] ?? DEFAULT_PIPELINE_COLOR,
      modelMins: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, m]) => ({
              model,
              mins:     Math.round(m.mins),
              sessions: m.sessions,
              avgFps:   m.sessions > 0 ? Math.round((m.fpsWeighted / m.sessions) * 10) / 10 : 0,
              gpus:     0,
            }))
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
    regions: entry.regions ?? [],
  }));
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

/** Count unique GPU IDs from SLA compliance rows (matching count-compliance-gpu-ids.sh). */
function countUniqueGPUIds(rows: SLAComplianceRow[]): number {
  const gpuIds = new Set<string>();
  for (const row of rows) {
    const id = row.gpu_id?.trim();
    if (id) gpuIds.add(id);
  }
  return gpuIds.size;
}

/** Dedicated query to /api/gpu/metrics for hardware breakdown (gpu_model_name counts). */
async function fetchHardwareBreakdownFromGPUMetrics(): Promise<Array<{ model: string; count: number }>> {
  const rows = await fetchGPUMetrics('24h');
  const modelCounts = new Map<string, Set<string>>();
  for (const m of rows) {
    if (!m.gpu_model_name || !m.gpu_id) continue;
    if (!modelCounts.has(m.gpu_model_name)) {
      modelCounts.set(m.gpu_model_name, new Set());
    }
    modelCounts.get(m.gpu_model_name)!.add(m.gpu_id);
  }
  return [...modelCounts.entries()]
    .map(([model, ids]) => ({ model, count: ids.size }))
    .sort((a, b) => b.count - a.count);
}

async function resolveGPUCapacity({ timeframe }: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  const timeframeHours = parseTimeframe(timeframe);
  const slaPeriod = `${timeframeHours}h`;

  const [slaRows, metricsWide, metricsRecent, models] = await Promise.all([
    getSLAComplianceRows(slaPeriod),
    fetchGPUMetrics('24h'),
    fetchGPUMetrics('1h'),
    fetchHardwareBreakdownFromGPUMetrics(),
  ]);

  const totalGPUs = countUniqueGPUIds(slaRows);

  const activeGpuIds = new Set<string>();
  for (const row of slaRows) {
    const id = row.gpu_id?.trim();
    if (id && (row.known_sessions_count ?? 0) > 0) activeGpuIds.add(id);
  }
  const activeGPUs = activeGpuIds.size;

  const sample = metricsRecent.length > 0 ? metricsRecent : metricsWide;
  const avgAvailable = sample.length > 0
    ? Math.round(
        (1 - sample.reduce((s, m) => s + m.startup_unexcused_rate, 0) / sample.length) * 100
      )
    : 100;

  // Pipeline GPU breakdown from SLA (timeframe-scoped)
  const byPipeline = countGPUsByPipelineFromSLA(slaRows);
  const pipelineGPUs = [...byPipeline.entries()]
    .map(([pipelineId, acc]) => ({
      name: PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      gpus: acc.total,
      models: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, gpus]) => ({ model, gpus }))
            .sort((a, b) => b.gpus - a.gpus)
        : undefined,
    }))
    .sort((a, b) => b.gpus - a.gpus);

  return { totalGPUs, activeGPUs: activeGPUs, availableCapacity: avgAvailable, models, pipelineGPUs };
}

// ---------------------------------------------------------------------------
// Orchestrators resolver
// ---------------------------------------------------------------------------

async function resolveOrchestrators({ period = '168h' }: { period?: string }): Promise<DashboardOrchestrator[]> {
  // Normalize period from query variable (e.g. "168" from $timeframe) to API format "168h"
  const periodHours = period && /^\d+$/.test(period) ? parseInt(period, 10) : NaN;
  const resolvedPeriod = Number.isFinite(periodHours) ? `${Math.min(periodHours, 720)}h` : (period || '168h');
  const rows = await getSLAComplianceRows(resolvedPeriod);

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
    gpuCapacity:     (args?: { timeframe?: string }) => resolveGPUCapacity({ timeframe: args?.timeframe }),
    pricing:         async () => [],
    orchestrators:   ({ period }: { period?: string }) => resolveOrchestrators({ period }),
    // Raw explorer resolvers
    networkDemand:   (args: NetworkDemandFilters) => resolveRawNetworkDemand(args),
    gpuMetrics:      (args: GPUMetricsFilters) => resolveRawGPUMetrics(args),
    slaCompliance:   (args: SLAComplianceFilters) => resolveRawSLACompliance(args),
  });
}
