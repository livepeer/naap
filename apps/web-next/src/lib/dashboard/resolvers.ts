/**
 * Dashboard BFF Resolvers
 *
 * All transformation + aggregation logic. Fetches raw max-window data from
 * upstream (via raw-data.ts, which uses Next.js fetch caching), then slices
 * and aggregates in memory for each widget request.
 */

import {
  type DashboardKPI,
  type DashboardPipelineUsage,
  type DashboardPipelineCatalogEntry,
  type DashboardGPUCapacity,
  type DashboardOrchestrator,
  type DashboardProtocol,
  type DashboardFeesInfo,
  type DashboardFeeWeeklyData,
  type RawNetworkDemandRow,
  type RawGPUMetricRow,
  type RawSLAComplianceRow,
  type NetworkDemandFilters,
  type GPUMetricsFilters,
  type SLAComplianceFilters,
} from '@naap/plugin-sdk';

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import {
  getRawDemandRows,
  getRawSLARows,
  getRawGPUMetricsRows,
  getRawPipelineCatalog,
  type NetworkDemandRow,
  type SLAComplianceRow,
  type GPUMetricRow,
} from './raw-data.js';

import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from './pipeline-config.js';

// ---------------------------------------------------------------------------
// Time slicing helper
// ---------------------------------------------------------------------------

function sliceByHours<T extends { window_start: string }>(rows: T[], hours: number): T[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return rows.filter(r => r.window_start >= cutoff);
}

// ---------------------------------------------------------------------------
// Timeframe parsing
// ---------------------------------------------------------------------------

const VALID_TIMEFRAMES = [24, 168, 336, 720] as const;
type TimeframeHours = (typeof VALID_TIMEFRAMES)[number];

function parseTimeframe(input?: string | number): TimeframeHours {
  const hours = typeof input === 'string' ? parseInt(input, 10) : input;
  if (hours && VALID_TIMEFRAMES.includes(hours as TimeframeHours)) return hours as TimeframeHours;
  return 168;
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

function weightedSuccessRate(rows: Array<{ effective_success_rate: number; known_sessions_count: number }>): number {
  const weightTotal = rows.reduce((s, r) => s + (r.known_sessions_count ?? 0), 0);
  if (weightTotal === 0) return 0;
  const weightedSum = rows.reduce((s, r) => s + (r.effective_success_rate ?? 0) * (r.known_sessions_count ?? 0), 0);
  return weightedSum / weightTotal;
}

/** Count distinct non-empty Ethereum addresses in an array of SLA rows */
function countOrchestrators(rows: SLAComplianceRow[]): number {
  return new Set(rows.map((r) => r.orchestrator_address).filter((a) => a?.startsWith('0x'))).size;
}

/** Round to one decimal place */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDays(days?: number): number {
  if (!days || Number.isNaN(days)) return 180;
  return Math.min(Math.max(Math.floor(days), 7), 365);
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getWeekStartTimestamp(dateS: number): number {
  const date = new Date(dateS * 1000);
  date.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayOfWeek);
  return Math.floor(date.getTime() / 1000);
}

/** Count total GPUs from SLA compliance: distinct GPUs with sessions + rows with sessions but no gpu_id. */
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

// ---------------------------------------------------------------------------
// Subgraph helpers
// ---------------------------------------------------------------------------

function getSubgraphUrl(): string {
  const apiKey = process.env.SUBGRAPH_API_KEY;
  const subgraphId = process.env.SUBGRAPH_ID || 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';
  if (!apiKey) throw new Error('SUBGRAPH_API_KEY is not set');
  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

// ---------------------------------------------------------------------------
// KPI resolver
// ---------------------------------------------------------------------------

export async function resolveKPI({ timeframe }: { timeframe?: string | number }): Promise<DashboardKPI & { timeframeHours: number }> {
  const timeframeHours = parseTimeframe(timeframe);

  const [allDemandRows, allSLARows] = await Promise.all([
    getRawDemandRows(),
    getRawSLARows(),
  ]);

  const demandRows = sliceByHours(allDemandRows, timeframeHours);
  const slaRows = sliceByHours(allSLARows, timeframeHours);

  // Success rate: weighted mean of effective_success_rate by known_sessions_count → percentage
  const currentSR = weightedSuccessRate(demandRows) * 100;

  // Orchestrators Seen: distinct addresses across the selected period
  const orchCount = countOrchestrators(slaRows) || 0;
  const orchDelta = 0;

  // Usage, Sessions, and Fees: sum over the selected timeframe
  const totalMins = demandRows.reduce((s, r) => s + (r.total_minutes || 0), 0);
  const totalStreams = demandRows.reduce((s, r) => s + (r.total_demand_sessions || 0), 0);
  const totalFeesEth = demandRows.reduce((s, r) => s + (r.ticket_face_value_eth || 0), 0);

  return {
    successRate: { value: round1(currentSR), delta: 0 },
    orchestratorsOnline: { value: orchCount, delta: orchDelta },
    dailyUsageMins: { value: Math.round(totalMins), delta: 0 },
    dailySessionCount: { value: totalStreams, delta: 0 },
    dailyNetworkFeesEth: { value: round1(totalFeesEth), delta: 0 },
    timeframeHours,
  };
}

// ---------------------------------------------------------------------------
// Pipelines resolver
// ---------------------------------------------------------------------------

export async function resolvePipelines({ limit = 5, timeframe }: { limit?: number; timeframe?: string | number }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit as number)) : 5;
  const timeframeHours = parseTimeframe(timeframe);

  const allDemandRows = await getRawDemandRows();
  const demand = sliceByHours(allDemandRows, timeframeHours);

  type PipelineModelAccum = { mins: number; sessions: number; fpsWeighted: number };
  type Accum = { mins: number; sessions: number; fpsWeighted: number; byModel: Map<string, PipelineModelAccum> };
  const byPipeline = new Map<string, Accum>();

  for (const row of demand) {
    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId || PIPELINE_DISPLAY[pipelineId] === null) continue;
    const mins = row.total_minutes ?? 0;
    const sessionsCt = row.sessions_count ?? 0;
    if (mins <= 0 && sessionsCt <= 0) continue;

    let acc = byPipeline.get(pipelineId);
    if (!acc) {
      acc = { mins: 0, sessions: 0, fpsWeighted: 0, byModel: new Map() };
      byPipeline.set(pipelineId, acc);
    }
    acc.mins += mins;
    acc.sessions += sessionsCt;
    if (sessionsCt > 0) {
      acc.fpsWeighted += (row.avg_output_fps ?? 0) * sessionsCt;
    }

    const modelId = row.model_id?.trim();
    if (modelId) {
      let modelAcc = acc.byModel.get(modelId);
      if (!modelAcc) {
        modelAcc = { mins: 0, sessions: 0, fpsWeighted: 0 };
        acc.byModel.set(modelId, modelAcc);
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
      name: PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      mins: Math.round(acc.mins),
      sessions: acc.sessions,
      avgFps: acc.sessions > 0 ? Math.round((acc.fpsWeighted / acc.sessions) * 10) / 10 : 0,
      color: PIPELINE_COLOR[pipelineId] ?? DEFAULT_PIPELINE_COLOR,
      modelMins: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, m]) => ({
              model,
              mins: Math.round(m.mins),
              sessions: m.sessions,
              avgFps: m.sessions > 0 ? Math.round((m.fpsWeighted / m.sessions) * 10) / 10 : 0,
            }))
            .sort((a, b) => b.mins - a.mins)
        : undefined,
    }))
    .sort((a, b) => b.mins - a.mins)
    .slice(0, safeLimit);
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

export async function resolveGPUCapacity({ timeframe }: { timeframe?: string | number } = {}): Promise<DashboardGPUCapacity> {
  const timeframeHours = parseTimeframe(timeframe);
  const gpuWindow = Math.min(timeframeHours, 72);

  const [allSLARows, allGPURows] = await Promise.all([
    getRawSLARows(),
    getRawGPUMetricsRows(),
  ]);

  const slaRows = sliceByHours(allSLARows, timeframeHours);
  const metricsRows = sliceByHours(allGPURows, gpuWindow);

  // Total GPUs: distinct gpu_ids from SLA
  const totalGPUIds = new Set<string>();
  for (const row of slaRows) {
    const id = row.gpu_id?.trim();
    if (id) totalGPUIds.add(id);
  }
  const totalGPUs = totalGPUIds.size;

  // Active GPUs: distinct gpu_ids with at least one known session
  const activeGpuIds = new Set<string>();
  for (const row of slaRows) {
    const id = row.gpu_id?.trim();
    if (id && (row.known_sessions_count ?? 0) > 0) activeGpuIds.add(id);
  }
  const activeGPUs = activeGpuIds.size;

  const avgAvailable = metricsRows.length > 0
    ? Math.round(
        (1 - metricsRows.reduce((s, m) => s + m.startup_unexcused_rate, 0) / metricsRows.length) * 100
      )
    : 100;

  // Hardware breakdown by gpu_model_name
  const modelCounts = new Map<string, Set<string>>();
  for (const m of metricsRows) {
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

  // Pipeline GPU breakdown from SLA
  const byPipelineGpus = new Map<string, { gpuIds: Set<string>; byModel: Map<string, Set<string>> }>();
  for (const row of slaRows) {
    const gpuId = row.gpu_id?.trim();
    if (!gpuId) continue;
    const pipelineId = row.pipeline_id?.trim();
    if (!pipelineId || PIPELINE_DISPLAY[pipelineId] === null) continue;
    const modelId = row.model_id?.trim() ?? '';
    if (!byPipelineGpus.has(pipelineId)) {
      byPipelineGpus.set(pipelineId, { gpuIds: new Set(), byModel: new Map() });
    }
    const pAcc = byPipelineGpus.get(pipelineId)!;
    pAcc.gpuIds.add(gpuId);
    if (!pAcc.byModel.has(modelId)) pAcc.byModel.set(modelId, new Set());
    pAcc.byModel.get(modelId)!.add(gpuId);
  }

  const pipelineGPUs = [...byPipelineGpus.entries()]
    .map(([pipelineId, acc]) => ({
      name: PIPELINE_DISPLAY[pipelineId] ?? pipelineId,
      gpus: acc.gpuIds.size,
      models: acc.byModel.size > 0
        ? [...acc.byModel.entries()]
            .map(([model, gpuIds]) => ({ model: model || '(no model)', gpus: gpuIds.size }))
            .sort((a, b) => b.gpus - a.gpus)
        : undefined,
    }))
    .sort((a, b) => b.gpus - a.gpus);

  return { totalGPUs, activeGPUs, availableCapacity: avgAvailable, models, pipelineGPUs };
}

// ---------------------------------------------------------------------------
// Orchestrators resolver
// ---------------------------------------------------------------------------

export async function resolveOrchestrators({ period = '168h' }: { period?: string } = {}): Promise<DashboardOrchestrator[]> {
  // Parse period string like "168h" → 168, or plain "168" → 168
  let periodHours: number;
  if (/^\d+h$/.test(period)) {
    periodHours = parseInt(period, 10);
  } else if (/^\d+$/.test(period)) {
    periodHours = parseInt(period, 10);
  } else {
    periodHours = 168;
  }
  if (!Number.isFinite(periodHours) || periodHours <= 0) periodHours = 168;

  const allSLARows = await getRawSLARows();
  const rows = sliceByHours(allSLARows, periodHours);

  type Accum = {
    knownSessions: number;
    successSessions: number;
    unexcusedSessions: number;
    swappedSessions: number;
    effectiveSuccessWeighted: number;
    pipelines: Set<string>;
    pipelineModels: Map<string, Set<string>>;
    gpuIds: Set<string>;
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
    // Only count GPUs that had sessions
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
// Pipeline Catalog resolver
// ---------------------------------------------------------------------------

export async function resolvePipelineCatalog(): Promise<DashboardPipelineCatalogEntry[]> {
  const catalog = await getRawPipelineCatalog();
  return catalog.map((entry) => ({
    id: entry.id,
    name: PIPELINE_DISPLAY[entry.id] ?? entry.id,
    models: entry.models ?? [],
    regions: entry.regions ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Protocol resolver
// ---------------------------------------------------------------------------

export async function resolveProtocol(): Promise<DashboardProtocol> {
  const subgraphUrl = getSubgraphUrl();

  const query = /* GraphQL */ `
    query ProtocolOverview {
      protocol(id: "0") {
        roundLength
        totalActiveStake
        currentRound {
          id
          startBlock
          initialized
        }
      }
    }
  `;

  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
    // @ts-expect-error — Next.js extended fetch options
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`subgraph HTTP ${res.status}`);
  }

  type SubgraphProtocolResponse = {
    data?: {
      protocol?: {
        roundLength: string;
        totalActiveStake: string;
        currentRound: { id: string; startBlock: string; initialized: boolean } | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };

  const body = (await res.json()) as SubgraphProtocolResponse;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }

  const protocol = body.data?.protocol;
  if (!protocol || !protocol.currentRound) {
    throw new Error('subgraph returned no protocol currentRound data');
  }

  const currentRound = Math.floor(toNumber(protocol.currentRound.id));
  const startBlock = Math.floor(toNumber(protocol.currentRound.startBlock));
  const initialized = Boolean(protocol.currentRound.initialized);
  const totalBlocks = Math.floor(toNumber(protocol.roundLength));
  const totalStakedLPT = toNumber(protocol.totalActiveStake);

  // Get current L1 block number
  let currentProtocolBlock: number | null = null;
  try {
    const rpcUrl = process.env.L1_RPC_URL?.trim();
    if (rpcUrl) {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      });
      const blockNumber = await client.getBlockNumber();
      currentProtocolBlock = Number(blockNumber);
    }
  } catch (err) {
    console.warn('[dashboard/resolvers] L1 RPC unavailable for protocol block:', err);
  }

  const rawProgress = initialized && Number.isFinite(currentProtocolBlock)
    ? Number(currentProtocolBlock) - startBlock
    : 0;
  const blockProgress = Math.max(0, Math.min(rawProgress, totalBlocks));

  return {
    currentRound,
    blockProgress,
    totalBlocks,
    totalStakedLPT,
  };
}

// ---------------------------------------------------------------------------
// Fees resolver
// ---------------------------------------------------------------------------

export async function resolveFees({ days }: { days?: number } = {}): Promise<DashboardFeesInfo> {
  const first = clampDays(days);
  const subgraphUrl = getSubgraphUrl();

  const query = /* GraphQL */ `
    query FeesOverview($first: Int!) {
      days(first: $first, orderBy: date, orderDirection: desc) {
        date
        volumeETH
        volumeUSD
      }
      protocol(id: "0") {
        totalVolumeETH
        totalVolumeUSD
      }
    }
  `;

  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { first } }),
    signal: AbortSignal.timeout(60_000),
    // @ts-expect-error — Next.js extended fetch options
    next: { revalidate: 15 * 60 },
  });

  if (!res.ok) {
    throw new Error(`subgraph HTTP ${res.status}`);
  }

  type SubgraphFeesResponse = {
    data?: {
      days?: Array<{ date: number; volumeETH: string; volumeUSD: string }>;
      protocol?: { totalVolumeETH: string; totalVolumeUSD: string } | null;
    };
    errors?: Array<{ message: string }>;
  };

  const body = (await res.json()) as SubgraphFeesResponse;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  if (!body.data) {
    throw new Error('subgraph returned no data');
  }

  const data = body.data;

  const dayData = (data?.days ?? [])
    .map((row) => ({
      dateS: Number(row.date),
      volumeEth: toNumber(row.volumeETH),
      volumeUsd: toNumber(row.volumeUSD),
    }))
    .filter((row) => Number.isFinite(row.dateS))
    .sort((a, b) => a.dateS - b.dateS);

  const weeklyMap = new Map<number, DashboardFeeWeeklyData>();
  for (const day of dayData) {
    const weekStart = getWeekStartTimestamp(day.dateS);
    const existing = weeklyMap.get(weekStart);
    if (existing) {
      existing.weeklyVolumeEth += day.volumeEth;
      existing.weeklyVolumeUsd += day.volumeUsd;
    } else {
      weeklyMap.set(weekStart, {
        date: weekStart,
        weeklyVolumeEth: day.volumeEth,
        weeklyVolumeUsd: day.volumeUsd,
      });
    }
  }

  const weeklyData = [...weeklyMap.values()]
    .sort((a, b) => a.date - b.date)
    .map((w) => ({
      ...w,
      weeklyVolumeEth: round2(w.weeklyVolumeEth),
      weeklyVolumeUsd: round2(w.weeklyVolumeUsd),
    }));

  const latestDay = dayData.at(-1);
  const previousDay = dayData.at(-2);
  const dayBeforePrevious = dayData.at(-3);
  const currentWeek = weeklyData.at(-1);
  const previousWeek = weeklyData.at(-2);
  const twoWeeksBack = weeklyData.at(-3);

  const fallbackTotalEth = round2(dayData.reduce((sum, d) => sum + d.volumeEth, 0));
  const fallbackTotalUsd = round2(dayData.reduce((sum, d) => sum + d.volumeUsd, 0));

  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0) / 1000;
  const weekStartOfToday = getWeekStartTimestamp(startOfTodayUtc);
  const isLatestDayIncomplete = latestDay != null && latestDay.dateS >= startOfTodayUtc;
  const isLatestWeekIncomplete = currentWeek != null && currentWeek.date >= weekStartOfToday;

  const dayForDisplay = isLatestDayIncomplete ? previousDay : latestDay;
  const dayForDeltaBase = isLatestDayIncomplete ? dayBeforePrevious : previousDay;
  const weekForDisplay = isLatestWeekIncomplete ? previousWeek : currentWeek;
  const weekForDeltaBase = isLatestWeekIncomplete ? twoWeeksBack : previousWeek;

  const protocolTotalEth = data?.protocol?.totalVolumeETH;
  const protocolTotalUsd = data?.protocol?.totalVolumeUSD;

  return {
    totalEth: protocolTotalEth != null ? round2(toNumber(protocolTotalEth)) : fallbackTotalEth,
    totalUsd: protocolTotalUsd != null ? round2(toNumber(protocolTotalUsd)) : fallbackTotalUsd,
    oneDayVolumeUsd: round2(dayForDisplay?.volumeUsd ?? 0),
    oneDayVolumeEth: round2(dayForDisplay?.volumeEth ?? 0),
    oneWeekVolumeUsd: round2(weekForDisplay?.weeklyVolumeUsd ?? 0),
    oneWeekVolumeEth: round2(weekForDisplay?.weeklyVolumeEth ?? 0),
    volumeChangeUsd: round2(percentChange(dayForDisplay?.volumeUsd ?? 0, dayForDeltaBase?.volumeUsd ?? 0)),
    volumeChangeEth: round2(percentChange(dayForDisplay?.volumeEth ?? 0, dayForDeltaBase?.volumeEth ?? 0)),
    weeklyVolumeChangeUsd: round2(
      percentChange(weekForDisplay?.weeklyVolumeUsd ?? 0, weekForDeltaBase?.weeklyVolumeUsd ?? 0)
    ),
    weeklyVolumeChangeEth: round2(
      percentChange(weekForDisplay?.weeklyVolumeEth ?? 0, weekForDeltaBase?.weeklyVolumeEth ?? 0)
    ),
    dayData,
    weeklyData,
  };
}

// ---------------------------------------------------------------------------
// Raw data resolvers (snake_case → camelCase transform)
// ---------------------------------------------------------------------------

/** Transform snake_case NetworkDemandRow to camelCase RawNetworkDemandRow */
function transformNetworkDemandRow(r: NetworkDemandRow): RawNetworkDemandRow {
  return {
    windowStart: r.window_start,
    gateway: r.gateway,
    region: r.region,
    pipelineId: r.pipeline_id,
    modelId: r.model_id,
    sessionsCount: r.sessions_count,
    totalMinutes: r.total_minutes,
    knownSessionsCount: r.known_sessions_count,
    servedSessions: r.served_sessions,
    unservedSessions: r.unserved_sessions,
    totalDemandSessions: r.total_demand_sessions,
    startupUnexcusedSessions: r.startup_unexcused_sessions,
    confirmedSwappedSessions: r.confirmed_swapped_sessions,
    inferredSwapSessions: r.inferred_swap_sessions,
    totalSwappedSessions: r.total_swapped_sessions,
    sessionsEndingInError: r.sessions_ending_in_error,
    errorStatusSamples: r.error_status_samples,
    healthSignalCoverageRatio: r.health_signal_coverage_ratio,
    startupSuccessRate: r.startup_success_rate,
    effectiveSuccessRate: r.effective_success_rate,
    ticketFaceValueEth: r.ticket_face_value_eth,
  };
}

/** Normalize CUDA version string (e.g. "12.4" → "12.4", "12" → "12") */
function normalizeCudaVersionForApi(version: string | null | undefined): string | null {
  if (!version) return null;
  const trimmed = version.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** Transform snake_case GPUMetricRow to camelCase RawGPUMetricRow */
function transformGPUMetricRow(r: GPUMetricRow): RawGPUMetricRow {
  return {
    windowStart: r.window_start,
    orchestratorAddress: r.orchestrator_address,
    pipelineId: r.pipeline_id,
    modelId: r.model_id,
    gpuId: r.gpu_id,
    region: r.region,
    gpuModelName: r.gpu_model_name,
    gpuMemoryBytesTotal: r.gpu_memory_bytes_total,
    runnerVersion: r.runner_version,
    cudaVersion: normalizeCudaVersionForApi(r.cuda_version),
    avgOutputFps: r.avg_output_fps,
    p95OutputFps: r.p95_output_fps,
    fpsJitterCoefficient: r.fps_jitter_coefficient,
    avgPromptToFirstFrameMs: r.avg_prompt_to_first_frame_ms,
    avgStartupLatencyMs: r.avg_startup_latency_ms,
    avgE2eLatencyMs: r.avg_e2e_latency_ms,
    p95PromptToFirstFrameLatencyMs: r.p95_prompt_to_first_frame_latency_ms,
    p95StartupLatencyMs: r.p95_startup_latency_ms,
    p95E2eLatencyMs: r.p95_e2e_latency_ms,
    promptToFirstFrameSampleCount: r.prompt_to_first_frame_sample_count,
    startupLatencySampleCount: r.startup_latency_sample_count,
    e2eLatencySampleCount: r.e2e_latency_sample_count,
    statusSamples: r.status_samples,
    errorStatusSamples: r.error_status_samples,
    knownSessionsCount: r.known_sessions_count,
    startupSuccessSessions: r.startup_success_sessions,
    startupExcusedSessions: r.startup_excused_sessions,
    startupUnexcusedSessions: r.startup_unexcused_sessions,
    confirmedSwappedSessions: r.confirmed_swapped_sessions,
    inferredSwapSessions: r.inferred_swap_sessions,
    totalSwappedSessions: r.total_swapped_sessions,
    sessionsEndingInError: r.sessions_ending_in_error,
    healthSignalCoverageRatio: r.health_signal_coverage_ratio,
    startupUnexcusedRate: r.startup_unexcused_rate,
    swapRate: r.swap_rate,
  };
}

/** Transform snake_case SLAComplianceRow to camelCase RawSLAComplianceRow */
function transformSLAComplianceRow(r: SLAComplianceRow): RawSLAComplianceRow {
  return {
    windowStart: r.window_start,
    orchestratorAddress: r.orchestrator_address,
    pipelineId: r.pipeline_id,
    modelId: r.model_id,
    gpuId: r.gpu_id,
    region: r.region,
    knownSessionsCount: r.known_sessions_count,
    startupSuccessSessions: r.startup_success_sessions,
    startupExcusedSessions: r.startup_excused_sessions,
    startupUnexcusedSessions: r.startup_unexcused_sessions,
    confirmedSwappedSessions: r.confirmed_swapped_sessions,
    inferredSwapSessions: r.inferred_swap_sessions,
    totalSwappedSessions: r.total_swapped_sessions,
    sessionsEndingInError: r.sessions_ending_in_error,
    errorStatusSamples: r.error_status_samples,
    healthSignalCoverageRatio: r.health_signal_coverage_ratio,
    startupSuccessRate: r.startup_success_rate,
    effectiveSuccessRate: r.effective_success_rate,
    noSwapRate: r.no_swap_rate,
    slaScore: r.sla_score,
  };
}

/** Parse window string like "24h" → 24 */
function parseWindowHours(window?: string): number | undefined {
  if (!window) return undefined;
  const match = window.match(/^(\d+)h?$/);
  if (!match) return undefined;
  return parseInt(match[1], 10);
}

export async function resolveRawNetworkDemand(filters: NetworkDemandFilters): Promise<RawNetworkDemandRow[]> {
  const allRows = await getRawDemandRows();
  let rows = allRows;

  if (filters.window) {
    const hours = parseWindowHours(filters.window);
    if (hours != null) rows = sliceByHours(rows, hours);
  }

  if (filters.gateway) {
    rows = rows.filter(r => r.gateway === filters.gateway);
  }
  if (filters.region) {
    rows = rows.filter(r => r.region === filters.region);
  }
  if (filters.pipelineId) {
    rows = rows.filter(r => r.pipeline_id === filters.pipelineId);
  }
  if (filters.modelId) {
    rows = rows.filter(r => r.model_id === filters.modelId);
  }

  return rows.map(transformNetworkDemandRow);
}

export async function resolveRawGPUMetrics(filters: GPUMetricsFilters): Promise<RawGPUMetricRow[]> {
  const allRows = await getRawGPUMetricsRows();
  let rows = allRows;

  if (filters.window) {
    const hours = parseWindowHours(filters.window);
    if (hours != null) {
      const capped = Math.min(hours, 72);
      rows = sliceByHours(rows, capped);
    }
  }

  if (filters.orchestratorAddress) {
    rows = rows.filter(r => r.orchestrator_address === filters.orchestratorAddress);
  }
  if (filters.pipelineId) {
    rows = rows.filter(r => r.pipeline_id === filters.pipelineId);
  }
  if (filters.modelId) {
    rows = rows.filter(r => r.model_id === filters.modelId);
  }
  if (filters.gpuId) {
    rows = rows.filter(r => r.gpu_id === filters.gpuId);
  }
  if (filters.region) {
    rows = rows.filter(r => r.region === filters.region);
  }
  if (filters.gpuModelName) {
    rows = rows.filter(r => r.gpu_model_name === filters.gpuModelName);
  }
  if (filters.runnerVersion) {
    rows = rows.filter(r => r.runner_version === filters.runnerVersion);
  }
  if (filters.cudaVersion) {
    const normalized = normalizeCudaVersionForApi(filters.cudaVersion);
    rows = rows.filter(r => normalizeCudaVersionForApi(r.cuda_version) === normalized);
  }

  return rows.map(transformGPUMetricRow);
}

export async function resolveRawSLACompliance(filters: SLAComplianceFilters): Promise<RawSLAComplianceRow[]> {
  const allRows = await getRawSLARows();
  let rows = allRows;

  if (filters.window) {
    const hours = parseWindowHours(filters.window);
    if (hours != null) rows = sliceByHours(rows, hours);
  }

  if (filters.orchestratorAddress) {
    rows = rows.filter(r => r.orchestrator_address === filters.orchestratorAddress);
  }
  if (filters.pipelineId) {
    rows = rows.filter(r => r.pipeline_id === filters.pipelineId);
  }
  if (filters.modelId) {
    rows = rows.filter(r => r.model_id === filters.modelId);
  }
  if (filters.gpuId) {
    rows = rows.filter(r => r.gpu_id === filters.gpuId);
  }
  if (filters.region) {
    rows = rows.filter(r => r.region === filters.region);
  }

  return rows.map(transformSLAComplianceRow);
}
