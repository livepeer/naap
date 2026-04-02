/**
 * Dashboard BFF Resolvers
 *
 * All transformation + aggregation logic. Fetches raw max-window data from
 * upstream (via raw-data.ts, which uses Next.js fetch caching), then slices
 * and aggregates in memory for each widget request.
 */

import {
  type DashboardKPI,
  type HourlyBucket,
  type DashboardPipelineUsage,
  type DashboardPipelineModelMins,
  type DashboardPipelineCatalogEntry,
  type DashboardGPUCapacity,
  type DashboardOrchestrator,
  type DashboardProtocol,
  type DashboardFeesInfo,
  type DashboardFeeWeeklyData,
} from '@naap/plugin-sdk';

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import {
  DASHBOARD_MAX_HOURS,
  getRawDemandRows,
  getRawSLARows,
  getRawPipelineCatalog,
  type SLAComplianceRow,
} from './raw-data.js';

import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from './pipeline-config.js';

import { buildContiguousDemandHourlyBuckets } from './hourly-buckets.js';

// ---------------------------------------------------------------------------
// Timeframe parsing
// ---------------------------------------------------------------------------

/** Sub-24h increments; must not exceed {@link DASHBOARD_MAX_HOURS}. */
const VALID_TIMEFRAMES = [1, 6, 12, 18, 24] as const;
type TimeframeHours = (typeof VALID_TIMEFRAMES)[number];

function parseTimeframe(input?: string | number): TimeframeHours {
  const hours = typeof input === 'string' ? parseInt(input, 10) : input;
  if (hours && VALID_TIMEFRAMES.includes(hours as TimeframeHours)) return hours as TimeframeHours;
  return DASHBOARD_MAX_HOURS;
}

// ---------------------------------------------------------------------------
// Shared aggregation helpers
// ---------------------------------------------------------------------------

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

  // Request exactly the selected lookback from upstream (`window=Nh`) so totals match API
  // semantics instead of relying on in-memory `window_start` slicing.
  const [demandRows, slaRows] = await Promise.all([
    getRawDemandRows(timeframeHours),
    getRawSLARows(timeframeHours),
  ]);

  // Success rate: weighted mean of effective_success_rate by known_sessions_count → percentage
  const currentSR = weightedSuccessRate(demandRows) * 100;

  // Orchestrators Seen: distinct addresses across the selected period
  const orchCount = countOrchestrators(slaRows) || 0;
  const orchDelta = 0;

  // Usage, Sessions, and Fees: sum over the selected timeframe
  const totalMins = demandRows.reduce((s, r) => s + (r.total_minutes || 0), 0);
  const totalStreams = demandRows.reduce((s, r) => s + (r.total_demand_sessions || 0), 0);
  const totalFeesEth = demandRows.reduce((s, r) => s + (r.ticket_face_value_eth || 0), 0);

  // Per-hour breakdowns: contiguous UTC hours ending at the latest bucket in the
  // NAAP API response (missing hours are zero-filled so the chart has a full window).
  const hourlyUsage: HourlyBucket[] = buildContiguousDemandHourlyBuckets(
    demandRows,
    timeframeHours,
    'minutes'
  );
  const hourlySessions: HourlyBucket[] = buildContiguousDemandHourlyBuckets(
    demandRows,
    timeframeHours,
    'sessions'
  );

  return {
    successRate: { value: round1(currentSR), delta: 0 },
    orchestratorsOnline: { value: orchCount, delta: orchDelta },
    dailyUsageMins: { value: Math.round(totalMins), delta: 0 },
    dailySessionCount: { value: totalStreams, delta: 0 },
    dailyNetworkFeesEth: { value: round1(totalFeesEth), delta: 0 },
    timeframeHours,
    hourlyUsage,
    hourlySessions,
  };
}

// ---------------------------------------------------------------------------
// Pipelines resolver
// ---------------------------------------------------------------------------

/**
 * Pipeline ID used for live-video-to-video sessions.
 * The NAAP API sometimes emits these with `pipeline_id` empty and the constraint
 * name (e.g. "noop", "streamdiffusion-sdxl") in `model_id`. We normalise all
 * such rows under this parent key so they appear as a single grouped entry
 * with a per-model breakdown in `modelMins`.
 */
const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';

/**
 * model_id values emitted by the NAAP API for live-video-to-video sessions
 * when `pipeline_id` is absent.  Keep in sync with pipeline-config.ts entries
 * whose parent pipeline is LIVE_VIDEO_PIPELINE_ID.
 */
const LIVE_VIDEO_MODEL_IDS = new Set(['noop', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v']);

/** Set `DEBUG_PIPELINE_MINS=1` in the server env to log demand rows + modelMins for pipelines debugging. */
const DEBUG_PIPELINE_MINS = process.env.DEBUG_PIPELINE_MINS === '1';

function normalizeModelId(m: string): string {
  return m.startsWith('streamdiffusion') && !LIVE_VIDEO_MODEL_IDS.has(m) ? 'streamdiffusion-sdxl' : m;
}

function isLiveVideoDemandRow(row: { pipeline_id: string; model_id: string | null }): boolean {
  const p = row.pipeline_id?.trim() ?? '';
  const m = normalizeModelId(row.model_id?.trim() ?? '');
  return p === LIVE_VIDEO_PIPELINE_ID || LIVE_VIDEO_MODEL_IDS.has(m);
}

export async function resolvePipelines({ limit = 5, timeframe }: { limit?: number; timeframe?: string | number }): Promise<DashboardPipelineUsage[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit as number)) : 5;
  const timeframeHours = parseTimeframe(timeframe);

  const demand = await getRawDemandRows(timeframeHours);

  if (DEBUG_PIPELINE_MINS) {
    const lvRelated = demand.filter(isLiveVideoDemandRow);
    const sample = lvRelated.slice(0, 40).map((r) => ({
      pipeline_id: r.pipeline_id,
      model_id: r.model_id,
      total_minutes: r.total_minutes,
      sessions_count: r.sessions_count,
    }));
    console.log(
      `[dashboard/resolvePipelines] DEBUG timeframeHours=${timeframeHours} totalDemandRows=${demand.length} liveVideoRelatedRows=${lvRelated.length}`,
    );
    console.log('[dashboard/resolvePipelines] DEBUG live-video-related sample (up to 40):', JSON.stringify(sample));
  }

  type Accum = { mins: number; sessions: number; fpsWeighted: number };
  type PipelineAccum = Accum & { modelAccums: Map<string, Accum> };
  const byPipeline = new Map<string, PipelineAccum>();

  for (const row of demand) {
    const rawModel = row.model_id?.trim() || null;
    const rawPipeline = row.pipeline_id?.trim() || null;
    const normalizedModel = rawModel ? normalizeModelId(rawModel) : null;

    let pipelineKey: string;
    let modelKey: string | null = null;

    if (rawPipeline === LIVE_VIDEO_PIPELINE_ID || LIVE_VIDEO_MODEL_IDS.has(normalizedModel ?? '')) {
      // Group all live-video-to-video variants under a single pipeline entry.
      pipelineKey = LIVE_VIDEO_PIPELINE_ID;
      modelKey = rawModel;
    } else if (rawPipeline) {
      // Normal case: pipeline_id is the parent, model_id is the per-model breakdown.
      if (PIPELINE_DISPLAY[rawPipeline] === null) continue;
      pipelineKey = rawPipeline;
      modelKey = rawModel;
    } else {
      // Only model_id is set and it is not a live-video-to-video alias.
      // Treat it as a standalone pipeline name (e.g. capability variants reported
      // without a pipeline_id by older API versions).
      pipelineKey = rawModel || '';
      if (!pipelineKey || PIPELINE_DISPLAY[pipelineKey] === null) continue;
    }

    const mins = row.total_minutes ?? 0;
    const sessionsCt = row.sessions_count ?? 0;
    if (mins <= 0 && sessionsCt <= 0) continue;

    if (!byPipeline.has(pipelineKey)) {
      byPipeline.set(pipelineKey, { mins: 0, sessions: 0, fpsWeighted: 0, modelAccums: new Map() });
    }
    const acc = byPipeline.get(pipelineKey)!;
    acc.mins += mins;
    acc.sessions += sessionsCt;
    if (sessionsCt > 0) acc.fpsWeighted += (row.avg_output_fps ?? 0) * sessionsCt;

    if (modelKey) {
      if (!acc.modelAccums.has(modelKey)) {
        acc.modelAccums.set(modelKey, { mins: 0, sessions: 0, fpsWeighted: 0 });
      }
      const mAcc = acc.modelAccums.get(modelKey)!;
      mAcc.mins += mins;
      mAcc.sessions += sessionsCt;
      if (sessionsCt > 0) mAcc.fpsWeighted += (row.avg_output_fps ?? 0) * sessionsCt;
    }
  }

  const result = [...byPipeline.entries()]
    .map(([pipelineId, acc]): DashboardPipelineUsage => {
      const modelMins: DashboardPipelineModelMins[] = [...acc.modelAccums.entries()]
        .map(([model, m]) => ({
          model,
          mins: Math.round(m.mins),
          sessions: m.sessions,
          avgFps: m.sessions > 0 ? Math.round((m.fpsWeighted / m.sessions) * 10) / 10 : 0,
        }))
        .sort((a, b) => b.mins - a.mins);

      return {
        name: pipelineId,
        mins: Math.round(acc.mins),
        sessions: acc.sessions,
        avgFps: acc.sessions > 0 ? Math.round((acc.fpsWeighted / acc.sessions) * 10) / 10 : 0,
        color: PIPELINE_COLOR[pipelineId] ?? DEFAULT_PIPELINE_COLOR,
        ...(modelMins.length > 0 ? { modelMins } : {}),
      };
    })
    .sort((a, b) => b.mins - a.mins)
    .slice(0, safeLimit);

  if (DEBUG_PIPELINE_MINS) {
    const lv = result.find((p) => p.name === LIVE_VIDEO_PIPELINE_ID);
    console.log(
      '[dashboard/resolvePipelines] DEBUG live-video-to-video resolved:',
      JSON.stringify({
        pipelineMins: lv?.mins,
        modelMins: lv?.modelMins?.map((m) => ({ model: m.model, mins: m.mins, sessions: m.sessions })),
      }),
    );
    const topNames = result.map((p) => ({ name: p.name, mins: p.mins, modelCount: p.modelMins?.length ?? 0 }));
    console.log('[dashboard/resolvePipelines] DEBUG pipelines slice (limit applied):', JSON.stringify(topNames));
  }

  return result;
}

// ---------------------------------------------------------------------------
// GPU Capacity resolver
// ---------------------------------------------------------------------------

/**
 * Intentional stub: GPU capacity is produced by the REALTIME_QUERY `gpuCapacity`
 * field in the dashboard Graph layer, not here. Callers resolving the full
 * dashboard via that path receive live totals; this resolver exists for API
 * surface completeness only — TODO: optional fallback if we ever need
 * gpuCapacity without the realtime bundle.
 */
export async function resolveGPUCapacity(_opts: { timeframe?: string | number } = {}): Promise<DashboardGPUCapacity> {
  return {
    totalGPUs: 0,
    activeGPUs: 0,
    availableCapacity: 0,
    models: [],
    pipelineGPUs: [],
  };
}

// ---------------------------------------------------------------------------
// Orchestrators resolver
// ---------------------------------------------------------------------------

export async function resolveOrchestrators({
  period = `${DASHBOARD_MAX_HOURS}h`,
}: { period?: string } = {}): Promise<DashboardOrchestrator[]> {
  // Parse period string like "24h" → 24, or plain "24" → 24
  let periodHours: number;
  if (/^\d+h$/.test(period)) {
    periodHours = parseInt(period, 10);
  } else if (/^\d+$/.test(period)) {
    periodHours = parseInt(period, 10);
  } else {
    periodHours = DASHBOARD_MAX_HOURS;
  }
  if (!Number.isFinite(periodHours) || periodHours <= 0) {
    periodHours = DASHBOARD_MAX_HOURS;
  }
  periodHours = Math.min(periodHours, DASHBOARD_MAX_HOURS);

  const rows = await getRawSLARows(periodHours);

  type Accum = {
    knownSessions: number;
    successSessions: number;
    unexcusedSessions: number;
    swappedSessions: number;
    effectiveSuccessWeighted: number;
    pipelines: Set<string>;
    pipelineModels: Map<string, Set<string>>;
    gpuIds: Set<string>;
    /** True if any session row lacked gpu_id — count at most one anonymous GPU per orchestrator. */
    hasAnonymousGpu: boolean;
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
        gpuIds: new Set(), hasAnonymousGpu: false,
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
      d.hasAnonymousGpu = true;
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

      const gpuCount = d.gpuIds.size + (d.hasAnonymousGpu ? 1 : 0);

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
  return catalog
    .filter((entry) => PIPELINE_DISPLAY[entry.id] !== null)
    .map((entry) => ({
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
    next: { revalidate: 60 },
  } as RequestInit & { next: { revalidate: number } });

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
    next: { revalidate: 15 * 60 },
  } as RequestInit & { next: { revalidate: number } });

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

  /**
   * Incomplete latest period: when `isLatestDayIncomplete` (today’s bucket still
   * open), use previousDay for display and dayBeforePrevious for the delta base;
   * when `isLatestWeekIncomplete` (current week still open), use previousWeek
   * for display and twoWeeksBack for the delta base. Later null checks on
   * dayForDisplay/dayForDeltaBase and weekForDisplay/weekForDeltaBase ensure we
   * only compute changes when at least three days/weeks exist; otherwise those
   * change values stay null.
   */
  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0) / 1000;
  const weekStartOfToday = getWeekStartTimestamp(startOfTodayUtc);
  const isLatestDayIncomplete = latestDay != null && latestDay.dateS >= startOfTodayUtc;
  const isLatestWeekIncomplete = currentWeek != null && currentWeek.date >= weekStartOfToday;

  const dayForDisplay = isLatestDayIncomplete ? previousDay : latestDay;
  const dayForDeltaBase = isLatestDayIncomplete ? dayBeforePrevious : previousDay;
  const weekForDisplay = isLatestWeekIncomplete ? previousWeek : currentWeek;
  const weekForDeltaBase = isLatestWeekIncomplete ? twoWeeksBack : previousWeek;
  const volumeChangeUsd = dayForDeltaBase != null && dayForDisplay != null
    ? round2(percentChange(dayForDisplay.volumeUsd, dayForDeltaBase.volumeUsd))
    : null;
  const volumeChangeEth = dayForDeltaBase != null && dayForDisplay != null
    ? round2(percentChange(dayForDisplay.volumeEth, dayForDeltaBase.volumeEth))
    : null;
  const weeklyVolumeChangeUsd = weekForDeltaBase != null && weekForDisplay != null
    ? round2(percentChange(weekForDisplay.weeklyVolumeUsd, weekForDeltaBase.weeklyVolumeUsd))
    : null;
  const weeklyVolumeChangeEth = weekForDeltaBase != null && weekForDisplay != null
    ? round2(percentChange(weekForDisplay.weeklyVolumeEth, weekForDeltaBase.weeklyVolumeEth))
    : null;

  const protocolTotalEth = data?.protocol?.totalVolumeETH;
  const protocolTotalUsd = data?.protocol?.totalVolumeUSD;

  return {
    totalEth: protocolTotalEth != null ? round2(toNumber(protocolTotalEth)) : fallbackTotalEth,
    totalUsd: protocolTotalUsd != null ? round2(toNumber(protocolTotalUsd)) : fallbackTotalUsd,
    oneDayVolumeUsd: round2(dayForDisplay?.volumeUsd ?? 0),
    oneDayVolumeEth: round2(dayForDisplay?.volumeEth ?? 0),
    oneWeekVolumeUsd: round2(weekForDisplay?.weeklyVolumeUsd ?? 0),
    oneWeekVolumeEth: round2(weekForDisplay?.weeklyVolumeEth ?? 0),
    volumeChangeUsd,
    volumeChangeEth,
    weeklyVolumeChangeUsd,
    weeklyVolumeChangeEth,
    dayData,
    weeklyData,
  };
}

