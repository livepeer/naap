/**
 * Orchestrators resolver — NAAP Dashboard API backed.
 *
 * The endpoint returns fully enriched rows with serviceUri, pipelines,
 * pipelineModels, gpuCount, and SLA metrics. No merge with net/orchestrators
 * is needed. SLA metrics arrive as 0–100 percentages (successRatio) or 0–1
 * ratios (effectiveSuccessRate, noSwapRatio, slaScore); we normalize to
 * percentages for the UI.
 *
 * Source:
 *   GET /v1/dashboard/orchestrators?window=Wh
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface ApiOrchestrator {
  address: string;
  serviceUri: string;
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

/** Round to 2 decimal places. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Convert 0–1 ratio to percentage, rounded to 2dp. */
function pct(v: number | null): number | null {
  return v !== null ? r2(v * 100) : null;
}

export async function resolveOrchestrators(opts?: { period?: string }): Promise<DashboardOrchestrator[]> {
  const window = orchestratorWindowFromPeriod(opts?.period);
  return cachedFetch(`facade:orchestrators:${window}`, TTL.ORCHESTRATORS, async () => {
    const rows = await naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window }, {
      cache: 'no-store',
      errorLabel: 'orchestrators',
    });

    return rows
      .filter((r) => r.serviceUri && r.serviceUri.trim().length > 0)
      .map((r): DashboardOrchestrator => ({
        address: r.address,
        uris: [r.serviceUri],
        knownSessions: r.knownSessions,
        successSessions: r.successSessions,
        successRatio: r2(r.successRatio),
        effectiveSuccessRate: pct(r.effectiveSuccessRate),
        noSwapRatio: pct(r.noSwapRatio),
        slaScore: r.slaScore !== null ? Math.round(r.slaScore) : null,
        pipelines: r.pipelines,
        pipelineModels: r.pipelineModels,
        gpuCount: r.gpuCount,
      }));
  });
}
