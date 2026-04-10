/**
 * Orchestrators resolver — net registry as source of truth, dashboard merge.
 *
 * The Overview table **lists every distinct address** from GET /v1/net/orchestrators
 * (active_only=false, paged limit/offset — see net-orchestrators.ts), in registry order.
 * For each address, when GET /v1/dashboard/orchestrators includes the same address
 * for the requested window, we fill SLA/session/GPU/pipeline fields from that row;
 * otherwise we use empty metrics.
 *
 * Rows with no non-empty service URI are dropped so the table only lists reachable
 * orchestrators.
 *
 * The dashboard API returns effectiveSuccessRate, noSwapRatio, and slaScore in 0–1
 * range; they are multiplied by 100 for the UI.
 *
 * Source:
 *   GET /v1/net/orchestrators?active_only=false&limit=…[&cursor=…]
 *   GET /v1/dashboard/orchestrators?window=Wh
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import {
  getNetOrchestratorDataSafe,
  hasNonBlankServiceUri,
} from './net-orchestrators.js';

interface ApiOrchestrator {
  address: string;
  ensName?: string;
  serviceUri?: string;
  knownSessions: number;
  successSessions: number;
  successRatio: number;
  effectiveSuccessRate: number | null;
  noSwapRatio: number | null;
  slaScore: number | null;
  slaWindowStart?: string | null;
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

function mergePipelineModels(
  sla: { pipelineId: string; modelIds: string[] }[],
  raw: { pipelineId: string; modelIds: string[] }[],
): { pipelineId: string; modelIds: string[] }[] {
  const byPipeline = new Map<string, Set<string>>();
  for (const offer of [...sla, ...raw]) {
    let models = byPipeline.get(offer.pipelineId);
    if (!models) {
      models = new Set();
      byPipeline.set(offer.pipelineId, models);
    }
    for (const m of offer.modelIds) {
      models.add(m);
    }
  }
  return [...byPipeline.entries()].map(([pipelineId, modelSet]) => ({
    pipelineId,
    modelIds: [...modelSet].sort((a, b) => a.localeCompare(b)),
  }));
}

function mapDashboardIntoNetRow(
  addressLower: string,
  dash: ApiOrchestrator,
  netData: Awaited<ReturnType<typeof getNetOrchestratorDataSafe>>,
): DashboardOrchestrator {
  const display = netData.displayAddressByLower.get(addressLower) ?? dash.address;
  const rawOffers = netData.pipelineModelsByAddress.get(addressLower) ?? [];
  const pipelineModels = mergePipelineModels(dash.pipelineModels, rawOffers);
  const pipelineSet = new Set([...dash.pipelines, ...pipelineModels.map((o) => o.pipelineId)]);
  const lastSeenMs = netData.lastSeenMsByAddress.get(addressLower);
  return {
    address: display,
    uris: netData.urisByAddress.get(addressLower) ?? [],
    lastSeen: lastSeenMs !== undefined ? new Date(lastSeenMs).toISOString() : null,
    knownSessions: dash.knownSessions,
    successSessions: dash.successSessions,
    successRatio: pct(dash.successRatio) ?? 0,
    effectiveSuccessRate: pct(dash.effectiveSuccessRate),
    noSwapRatio: pct(dash.noSwapRatio),
    slaScore: dash.slaScore !== null ? Math.round(dash.slaScore * 100) : null,
    pipelines: [...pipelineSet],
    pipelineModels,
    gpuCount: dash.gpuCount,
  };
}

function netOnlyPlaceholder(
  addressLower: string,
  netData: Awaited<ReturnType<typeof getNetOrchestratorDataSafe>>,
): DashboardOrchestrator {
  const pipelineModels = netData.pipelineModelsByAddress.get(addressLower) ?? [];
  const lastSeenMs = netData.lastSeenMsByAddress.get(addressLower);
  return {
    address: netData.displayAddressByLower.get(addressLower) ?? addressLower,
    uris: netData.urisByAddress.get(addressLower) ?? [],
    lastSeen: lastSeenMs !== undefined ? new Date(lastSeenMs).toISOString() : null,
    knownSessions: 0,
    successSessions: 0,
    successRatio: 0,
    effectiveSuccessRate: null,
    noSwapRatio: null,
    slaScore: null,
    pipelines: pipelineModels.map((o) => o.pipelineId),
    pipelineModels,
    gpuCount: 0,
  };
}

export async function resolveOrchestrators(opts?: { period?: string }): Promise<DashboardOrchestrator[]> {
  const window = orchestratorWindowFromPeriod(opts?.period);
  return cachedFetch(`facade:orchestrators:${window}`, TTL.ORCHESTRATORS, async () => {
    const [dashRows, netData] = await Promise.all([
      naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window }, {
        cache: 'no-store',
        errorLabel: 'orchestrators',
      }),
      getNetOrchestratorDataSafe(),
    ]);

    const dashboardByLower = new Map<string, ApiOrchestrator>();
    for (const r of dashRows) {
      const k = r.address.toLowerCase();
      if (!dashboardByLower.has(k)) {
        dashboardByLower.set(k, r);
      }
    }

    const merged: DashboardOrchestrator[] = [];
    for (const addressLower of netData.urisByAddress.keys()) {
      const dash = dashboardByLower.get(addressLower);
      if (dash) {
        merged.push(mapDashboardIntoNetRow(addressLower, dash, netData));
      } else {
        merged.push(netOnlyPlaceholder(addressLower, netData));
      }
    }

    return merged.filter((row) => hasNonBlankServiceUri(row.uris));
  });
}
