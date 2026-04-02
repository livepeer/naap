/**
 * Orchestrators resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/orchestrators which returns per-orchestrator
 * SLA metrics pre-aggregated server-side, including SLA scores and pipeline offers.
 *
 * The API returns effectiveSuccessRate, noSwapRatio, and slaScore in 0–1 range;
 * they are multiplied by 100 to produce the percentage values the UI expects.
 *
 * Source:
 *   GET /v1/dashboard/orchestrators?window=Wh
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface ApiOrchestrator {
  address: string;
  knownSessions: number;
  successSessions: number;
  successRatio: number;
  effectiveSuccessRate: number | null;
  noSwapRatio: number | null;
  slaScore: number | null;
  pipelines: string[];
  pipelineModels: { pipelineId: string; modelIds: string[] }[];
  gpuCount: number;
}

interface NaapNetOrchestrator {
  Address: string;
  URI: string;
}

async function fetchURIMap(): Promise<Map<string, string>> {
  try {
    const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
    const rows = await naapGet<NaapNetOrchestrator[]>('net/orchestrators', {
      active_only: 'false',
    }, {
      next: { revalidate: revalidateSec },
      errorLabel: 'orchestrators-uri-map',
    });
    return new Map(rows.map((r) => [r.Address.toLowerCase(), r.URI]));
  } catch {
    return new Map();
  }
}

function pct(v: number | null): number | null {
  return v !== null ? Math.round(v * 1000) / 10 : null;
}

export async function resolveOrchestrators(opts?: { period?: string }): Promise<DashboardOrchestrator[]> {
  const period = opts?.period ?? '1000';
  const revalidateSec = Math.floor(TTL.ORCHESTRATORS / 1000);
  return cachedFetch(`facade:orchestrators:${period}`, TTL.ORCHESTRATORS, async () => {
    const [rows, uriMap] = await Promise.all([
      naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window: period }, {
        next: { revalidate: revalidateSec },
        errorLabel: 'orchestrators',
      }),
      fetchURIMap(),
    ]);
    return rows.map((r): DashboardOrchestrator => ({
      address: r.address,
      uri: uriMap.get(r.address.toLowerCase()),
      knownSessions: r.knownSessions,
      successSessions: r.successSessions,
      successRatio: pct(r.successRatio) ?? 0,
      effectiveSuccessRate: pct(r.effectiveSuccessRate),
      noSwapRatio: pct(r.noSwapRatio),
      slaScore: r.slaScore !== null ? Math.round(r.slaScore * 100) : null,
      pipelines: r.pipelines,
      pipelineModels: r.pipelineModels,
      gpuCount: r.gpuCount,
    }));
  });
}
