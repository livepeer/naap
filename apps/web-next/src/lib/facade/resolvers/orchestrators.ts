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
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

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

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/orchestrators] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function pct(v: number | null): number | null {
  return v !== null ? Math.round(v * 1000) / 10 : null;
}

export async function resolveOrchestrators(_opts: { period?: string }): Promise<DashboardOrchestrator[]> {
  return cachedFetch('facade:orchestrators', TTL.ORCHESTRATORS * 1000, async () => {
    const rows = await naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window: '24h' });
    return rows.map((r): DashboardOrchestrator => ({
      address: r.address,
      knownSessions: r.knownSessions,
      successSessions: r.successSessions,
      successRatio: Math.round(r.successRatio * 1000) / 10,
      effectiveSuccessRate: pct(r.effectiveSuccessRate),
      noSwapRatio: pct(r.noSwapRatio),
      slaScore: r.slaScore !== null ? Math.round(r.slaScore * 100) : null,
      pipelines: r.pipelines,
      pipelineModels: r.pipelineModels,
      gpuCount: r.gpuCount,
    }));
  });
}
