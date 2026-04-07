/**
 * Orchestrators resolver — NAAP Dashboard API backed.
 *
 * Fetches per-orchestrator SLA metrics from GET /v1/dashboard/orchestrators
 * and enriches each row with all known service URIs from the shared
 * net/orchestrators cache (see net-orchestrators.ts).
 *
 * The API returns effectiveSuccessRate, noSwapRatio, and slaScore in 0–1 range;
 * they are multiplied by 100 to produce the percentage values the UI expects.
 *
 * Source:
 *   GET /v1/dashboard/orchestrators?window=Wh
 *   GET /v1/net/orchestrators  (shared, cached)
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNetOrchestratorDataSafe } from './net-orchestrators.js';

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

/** Hours with optional trailing `h`, clamped to [1, 168] (same semantics as KPI `window`). */
function orchestratorWindowFromPeriod(period?: string): string {
  const raw = (period ?? '24').trim();
  const stripped = raw.toLowerCase().endsWith('h') ? raw.slice(0, -1).trim() : raw;
  const parsed = parseInt(stripped, 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  return `${hours}h`;
}

function pct(v: number | null): number | null {
  return v !== null ? Math.round(v * 1000) / 10 : null;
}

export async function resolveOrchestrators(opts?: { period?: string }): Promise<DashboardOrchestrator[]> {
  const window = orchestratorWindowFromPeriod(opts?.period);
  return cachedFetch(`facade:orchestrators:${window}`, TTL.ORCHESTRATORS, async () => {
    const [rows, netData] = await Promise.all([
      naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window }, {
        cache: 'no-store',
        errorLabel: 'orchestrators',
      }),
      getNetOrchestratorDataSafe(),
    ]);
    return rows.map((r): DashboardOrchestrator => ({
      address: r.address,
      uris: netData.urisByAddress.get(r.address.toLowerCase()) ?? [],
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
