/**
 * Orchestrators resolver — NAAP API backed.
 *
 * Fetches GET /v1/sla/compliance (paginated) and aggregates per orchestrator.
 *
 * Source:
 *   GET /v1/sla/compliance?window=24h → paginated SLA compliance rows
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types
// ---------------------------------------------------------------------------

interface NaapSLARow {
  window_start: string;
  orchestrator_address: string;
  pipeline_id: string;
  model_id: string | null;
  gpu_id: string | null;
  known_sessions_count: number;
  startup_success_sessions: number;
  startup_unexcused_sessions: number;
  confirmed_swapped_sessions: number;
  inferred_swap_sessions: number;
  total_swapped_sessions: number;
  effective_success_rate: number | null;
  no_swap_rate: number | null;
  sla_score: number | null;
}

interface NaapPaginatedResponse<T> {
  pagination?: { total_pages?: number };
  [key: string]: unknown;
  data?: T[];
}

// ---------------------------------------------------------------------------
// Paginated fetch helper
// ---------------------------------------------------------------------------

async function fetchAllSLARows(): Promise<NaapSLARow[]> {
  const pageSize = 200;
  const baseUrl = naapApiUpstreamUrl('sla/compliance');

  async function fetchPage(page: number): Promise<{ rows: NaapSLARow[]; totalPages: number }> {
    const url = new URL(baseUrl);
    url.searchParams.set('window', '24h');
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`[facade/orchestrators] sla/compliance page ${page} returned HTTP ${res.status}`);

    const body = (await res.json()) as NaapPaginatedResponse<NaapSLARow>;
    const rows = (body.compliance ?? body.data ?? []) as NaapSLARow[];
    const totalPages = Math.max(1, Math.floor(Number(body.pagination?.total_pages ?? 1)));
    return { rows, totalPages };
  }

  const { rows: firstRows, totalPages } = await fetchPage(1);
  if (totalPages <= 1) return firstRows;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2).then((r) => r.rows))
  );
  return [...firstRows, ...rest.flat()];
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveOrchestrators(_opts: { period?: string }): Promise<DashboardOrchestrator[]> {
  return cachedFetch('facade:orchestrators', TTL.ORCHESTRATORS * 1000, async () => {
    const rows = await fetchAllSLARows();

    type Accum = {
      knownSessions: number;
      successSessions: number;
      unexcusedSessions: number;
      swappedSessions: number;
      effectiveSuccessWeighted: number;
      pipelines: Set<string>;
      pipelineModels: Map<string, Set<string>>;
      gpuIds: Set<string>;
    };

    const byAddress = new Map<string, Accum>();

    for (const row of rows) {
      if (!row.orchestrator_address?.startsWith('0x')) continue;

      if (!byAddress.has(row.orchestrator_address)) {
        byAddress.set(row.orchestrator_address, {
          knownSessions: 0,
          successSessions: 0,
          unexcusedSessions: 0,
          swappedSessions: 0,
          effectiveSuccessWeighted: 0,
          pipelines: new Set(),
          pipelineModels: new Map(),
          gpuIds: new Set(),
        });
      }

      const d = byAddress.get(row.orchestrator_address)!;
      const known = row.known_sessions_count ?? 0;
      d.knownSessions += known;
      d.successSessions += row.startup_success_sessions ?? 0;
      d.unexcusedSessions += row.startup_unexcused_sessions ?? 0;
      d.swappedSessions += row.total_swapped_sessions ?? 0;
      d.effectiveSuccessWeighted += (row.effective_success_rate ?? 0) * known;

      if (row.pipeline_id) {
        d.pipelines.add(row.pipeline_id);
        if (known > 0 && row.model_id?.trim()) {
          if (!d.pipelineModels.has(row.pipeline_id)) d.pipelineModels.set(row.pipeline_id, new Set());
          d.pipelineModels.get(row.pipeline_id)!.add(row.model_id.trim());
        }
      }
      if (known > 0 && row.gpu_id) d.gpuIds.add(row.gpu_id);
    }

    return [...byAddress.entries()]
      .map(([address, d]): DashboardOrchestrator => {
        const successRatio = d.knownSessions > 0 ? 1 - d.unexcusedSessions / d.knownSessions : 0;
        const effectiveSuccessRate = d.knownSessions > 0
          ? d.effectiveSuccessWeighted / d.knownSessions
          : null;
        const noSwapRatio = d.knownSessions > 0 ? 1 - d.swappedSessions / d.knownSessions : null;
        const slaScore = d.knownSessions > 0
          ? (0.7 * successRatio + 0.3 * (noSwapRatio ?? 0)) * 100
          : null;

        return {
          address,
          knownSessions: d.knownSessions,
          successSessions: d.successSessions,
          successRatio: Math.round(successRatio * 1000) / 10,
          effectiveSuccessRate: effectiveSuccessRate !== null
            ? Math.round(effectiveSuccessRate * 1000) / 10
            : null,
          noSwapRatio: noSwapRatio !== null ? Math.round(noSwapRatio * 1000) / 10 : null,
          slaScore: slaScore !== null ? Math.round(slaScore) : null,
          pipelines: [...d.pipelines].sort(),
          pipelineModels: [...d.pipelineModels.entries()]
            .map(([pipelineId, modelIds]) => ({ pipelineId, modelIds: [...modelIds].sort() }))
            .sort((a, b) => a.pipelineId.localeCompare(b.pipelineId)),
          gpuCount: d.gpuIds.size,
        };
      })
      .sort((a, b) => b.knownSessions - a.knownSessions);
  });
}
