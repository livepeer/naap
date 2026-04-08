/**
 * Orchestrators resolver — net registry as source of truth, dashboard merge.
 *
 * The Overview table **lists every distinct address** from GET /v1/net/orchestrators
 * (active_only=false, limit=1000 — see net-orchestrators.ts), in registry order.
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
 *   GET /v1/net/orchestrators?active_only=false&limit=1000
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

function mapDashboardIntoNetRow(
  addressLower: string,
  dash: ApiOrchestrator,
  netData: Awaited<ReturnType<typeof getNetOrchestratorDataSafe>>,
): DashboardOrchestrator {
  const display = netData.displayAddressByLower.get(addressLower) ?? dash.address;
  return {
    address: display,
    uris: netData.urisByAddress.get(addressLower) ?? [],
    knownSessions: dash.knownSessions,
    successSessions: dash.successSessions,
    successRatio: pct(dash.successRatio) ?? 0,
    effectiveSuccessRate: pct(dash.effectiveSuccessRate),
    noSwapRatio: pct(dash.noSwapRatio),
    slaScore: dash.slaScore !== null ? Math.round(dash.slaScore * 100) : null,
    pipelines: dash.pipelines,
    pipelineModels: dash.pipelineModels,
    gpuCount: dash.gpuCount,
  };
}

function netOnlyPlaceholder(
  addressLower: string,
  netData: Awaited<ReturnType<typeof getNetOrchestratorDataSafe>>,
): DashboardOrchestrator {
  return {
    address: netData.displayAddressByLower.get(addressLower) ?? addressLower,
    uris: netData.urisByAddress.get(addressLower) ?? [],
    knownSessions: 0,
    successSessions: 0,
    successRatio: 0,
    effectiveSuccessRate: null,
    noSwapRatio: null,
    slaScore: null,
    pipelines: [],
    pipelineModels: [],
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
