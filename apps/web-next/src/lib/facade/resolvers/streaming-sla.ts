/**
 * Streaming SLA resolver — cursor-paginated per-capability SLA rollups.
 *
 * Source:
 *   GET /v1/streaming/sla?start=...&end=...&limit=...&cursor=...
 *
 * Returns two aggregates:
 * - by-orchestrator totals (for table-level SLA columns)
 * - per-(orchestrator, pipeline, model) totals (for capability tooltips)
 */

import type { DashboardOrchestratorPipelineModelSla } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

const STREAMING_SLA_PAGE_LIMIT = 1000;
const STREAMING_SLA_MAX_PAGES = 200;
/**
 * Always pull a 7-day lookback for streaming SLA aggregation (OpenAPI-documented max for
 * `/v1/streaming/sla`). The orchestrator dashboard period only affects ordering; SLA scores
 * need a meaningful sample size and tolerate upstreams that fall a day behind on ingestion.
 */
const STREAMING_SLA_LOOKBACK_HOURS = 168;

interface StreamingSlaRow {
  orchestrator_address: string;
  pipeline_id: string;
  model_id: string;
  requested_sessions: number;
  startup_success_sessions: number;
  effective_success_rate: number;
  no_swap_rate: number;
  avg_output_fps: number;
  sla_score: number;
}

interface StreamingSlaPage {
  data?: StreamingSlaRow[];
  pagination?: {
    next_cursor?: string;
    has_more?: boolean;
    page_size?: number;
  };
}

interface MutableAggregate {
  knownSessions: number;
  successSessions: number;
  weightedEffectiveSuccessRate: number;
  weightedNoSwapRate: number;
  weightedSlaScore: number;
  weightedOutputFps: number;
  weight: number;
}

export interface StreamingSlaAggregate {
  knownSessions: number;
  successSessions: number;
  successRatio: number | null;
  effectiveSuccessRate: number | null;
  noSwapRatio: number | null;
  slaScore: number | null;
  avgOutputFps: number | null;
}

export interface ResolvedStreamingSla {
  byOrchestrator: Map<string, StreamingSlaAggregate>;
  byOrchestratorCapability: Map<string, DashboardOrchestratorPipelineModelSla[]>;
}

function streamingSlaRangeIso(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - (STREAMING_SLA_LOOKBACK_HOURS * 60 * 60 * 1000));
  return { start: start.toISOString(), end: end.toISOString() };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalizePercent(v: number): number {
  return v <= 1 ? v * 100 : v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function emptyAggregate(): MutableAggregate {
  return {
    knownSessions: 0,
    successSessions: 0,
    weightedEffectiveSuccessRate: 0,
    weightedNoSwapRate: 0,
    weightedSlaScore: 0,
    weightedOutputFps: 0,
    weight: 0,
  };
}

function applyStreamingSlaRow(target: MutableAggregate, row: StreamingSlaRow): void {
  const requestedSessions = isFiniteNumber(row.requested_sessions) && row.requested_sessions > 0
    ? row.requested_sessions
    : 0;
  const startupSuccess = isFiniteNumber(row.startup_success_sessions) && row.startup_success_sessions >= 0
    ? row.startup_success_sessions
    : 0;

  target.knownSessions += requestedSessions;
  target.successSessions += startupSuccess;

  if (requestedSessions <= 0) return;
  target.weight += requestedSessions;

  if (isFiniteNumber(row.effective_success_rate)) {
    target.weightedEffectiveSuccessRate += normalizePercent(row.effective_success_rate) * requestedSessions;
  }
  if (isFiniteNumber(row.no_swap_rate)) {
    target.weightedNoSwapRate += normalizePercent(row.no_swap_rate) * requestedSessions;
  }
  if (isFiniteNumber(row.sla_score)) {
    target.weightedSlaScore += row.sla_score * requestedSessions;
  }
  if (isFiniteNumber(row.avg_output_fps)) {
    target.weightedOutputFps += row.avg_output_fps * requestedSessions;
  }
}

function finalizeAggregate(src: MutableAggregate): StreamingSlaAggregate {
  const successRatio = src.knownSessions > 0
    ? round1((src.successSessions / src.knownSessions) * 100)
    : null;
  const weightedValue = (sum: number) => (src.weight > 0 ? round1(sum / src.weight) : null);
  return {
    knownSessions: src.knownSessions,
    successSessions: src.successSessions,
    successRatio,
    effectiveSuccessRate: weightedValue(src.weightedEffectiveSuccessRate),
    noSwapRatio: weightedValue(src.weightedNoSwapRate),
    slaScore: weightedValue(src.weightedSlaScore),
    avgOutputFps: weightedValue(src.weightedOutputFps),
  };
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export async function resolveStreamingSla(): Promise<ResolvedStreamingSla> {
  return cachedFetch(`facade:streaming-sla:${STREAMING_SLA_LOOKBACK_HOURS}h`, TTL.ORCHESTRATORS, async () => {
    const { start, end } = streamingSlaRangeIso();
    const rows: StreamingSlaRow[] = [];
    let cursor = '';

    for (let page = 0; page < STREAMING_SLA_MAX_PAGES; page++) {
      const pageData = await naapGet<StreamingSlaPage>('streaming/sla', {
        start,
        end,
        limit: String(STREAMING_SLA_PAGE_LIMIT),
        ...(cursor ? { cursor } : {}),
      }, {
        cache: 'no-store',
        errorLabel: 'streaming-sla',
      });
      const chunk = Array.isArray(pageData.data) ? pageData.data : [];
      rows.push(...chunk);
      const nextCursor = pageData.pagination?.next_cursor?.trim() ?? '';
      const hasMore = pageData.pagination?.has_more === true && nextCursor.length > 0;
      if (!hasMore) break;
      cursor = nextCursor;
    }

    const byOrchestratorMutable = new Map<string, MutableAggregate>();
    const byCapabilityMutable = new Map<string, MutableAggregate>();

    for (const row of rows) {
      const addressLower = normalizeAddress(row.orchestrator_address);
      if (!addressLower) continue;
      const pipelineId = row.pipeline_id?.trim();
      const modelId = row.model_id?.trim();
      if (!pipelineId || !modelId) continue;

      let orchAgg = byOrchestratorMutable.get(addressLower);
      if (!orchAgg) {
        orchAgg = emptyAggregate();
        byOrchestratorMutable.set(addressLower, orchAgg);
      }
      applyStreamingSlaRow(orchAgg, row);

      const capKey = `${addressLower}\x1f${pipelineId}\x1f${modelId}`;
      let capAgg = byCapabilityMutable.get(capKey);
      if (!capAgg) {
        capAgg = emptyAggregate();
        byCapabilityMutable.set(capKey, capAgg);
      }
      applyStreamingSlaRow(capAgg, row);
    }

    const byOrchestrator = new Map<string, StreamingSlaAggregate>();
    for (const [addressLower, aggregate] of byOrchestratorMutable) {
      byOrchestrator.set(addressLower, finalizeAggregate(aggregate));
    }

    const byOrchestratorCapability = new Map<string, DashboardOrchestratorPipelineModelSla[]>();
    for (const [capKey, aggregate] of byCapabilityMutable) {
      const [addressLower, pipelineId, modelId] = capKey.split('\x1f');
      const finalized = finalizeAggregate(aggregate);
      const existing = byOrchestratorCapability.get(addressLower) ?? [];
      existing.push({
        pipelineId,
        modelId,
        knownSessions: finalized.knownSessions,
        successRatio: finalized.successRatio,
        effectiveSuccessRate: finalized.effectiveSuccessRate,
        noSwapRatio: finalized.noSwapRatio,
        slaScore: finalized.slaScore,
        avgOutputFps: finalized.avgOutputFps,
      });
      byOrchestratorCapability.set(addressLower, existing);
    }

    for (const [addressLower, rowsForAddress] of byOrchestratorCapability) {
      rowsForAddress.sort((a, b) => {
        if (b.knownSessions !== a.knownSessions) return b.knownSessions - a.knownSessions;
        const pipelineCmp = a.pipelineId.localeCompare(b.pipelineId);
        if (pipelineCmp !== 0) return pipelineCmp;
        return a.modelId.localeCompare(b.modelId);
      });
      byOrchestratorCapability.set(addressLower, rowsForAddress);
    }

    return { byOrchestrator, byOrchestratorCapability };
  });
}
