/**
 * Orchestrators resolver — dashboard SLA rows + streaming/requests inventory merge.
 *
 * OpenAPI `GET /v1/dashboard/orchestrators` returns one row per orchestrator with SLA
 * metrics (sorted by session volume). Inventory `GET /v1/streaming/orchestrators` and
 * `GET /v1/requests/orchestrators` supply URIs, last-seen, and capability rows but can
 * be a smaller set than the dashboard table. We **union** dashboard addresses (order
 * preserved) with any net-only addresses, then merge metrics and URIs (including
 * dashboard `serviceUri` when inventory has no URI yet).
 *
 * Rows with no non-empty service URI after merge are dropped.
 *
 * The dashboard API returns effectiveSuccessRate, noSwapRatio, and slaScore in 0–1
 * range; they are multiplied by 100 for the UI.
 *
 * Source:
 *   GET /v1/dashboard/orchestrators?window=… — **capped at 24h** for upstream performance
 *     (wider UI timeframes still load the table; SLA metrics use at most the last 24h).
 *   GET /v1/streaming/orchestrators + GET /v1/requests/orchestrators (see net-orchestrators.ts)
 */

import type { DashboardOrchestrator } from '@naap/plugin-sdk';
import { OVERVIEW_TIMEFRAME_MAX_HOURS } from '@/lib/dashboard/overview-timeframe';
import { formatDashboardWindow } from '../dashboard-window.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import {
  getNetOrchestratorDataSafe,
  hasNonBlankServiceUri,
} from './net-orchestrators.js';

interface ApiOrchestrator {
  address: string;
  /** OpenAPI `serviceUri` — may be only URI when inventory rows omit `uri`. */
  serviceUri?: string;
  service_uri?: string;
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

/** Wider UI windows make this endpoint expensive; do not exceed 24h on the NAAP dashboard route. */
export const DASHBOARD_ORCHESTRATORS_UPSTREAM_MAX_HOURS = 24;

/**
 * Hours with optional trailing `h`, clamped to [1, {@link OVERVIEW_TIMEFRAME_MAX_HOURS}], then capped at
 * {@link DASHBOARD_ORCHESTRATORS_UPSTREAM_MAX_HOURS}; formatted like other dashboard `window` values.
 */
export function orchestratorUpstreamWindowFromPeriod(period?: string): string {
  const raw = (period ?? '24').trim();
  const stripped = raw.toLowerCase().endsWith('h') ? raw.slice(0, -1).trim() : raw;
  const parsed = parseInt(stripped, 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, OVERVIEW_TIMEFRAME_MAX_HOURS));
  const capped = Math.min(hours, DASHBOARD_ORCHESTRATORS_UPSTREAM_MAX_HOURS);
  return formatDashboardWindow(capped);
}

function mergeOrchestratorServiceUris(netUris: string[], dash: ApiOrchestrator): string[] {
  const out = [...netUris];
  const extra =
    (typeof dash.serviceUri === 'string' && dash.serviceUri.trim()) ||
    (typeof dash.service_uri === 'string' && dash.service_uri.trim()) ||
    '';
  if (extra && !out.includes(extra)) {
    out.push(extra);
  }
  return out;
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
  const netUris = netData.urisByAddress.get(addressLower) ?? [];
  const uris = mergeOrchestratorServiceUris(netUris, dash);
  const rawOffers = netData.pipelineModelsByAddress.get(addressLower) ?? [];
  const pipelineModels = mergePipelineModels(dash.pipelineModels, rawOffers);
  const pipelineSet = new Set([...dash.pipelines, ...pipelineModels.map((o) => o.pipelineId)]);
  const lastSeenMs = netData.lastSeenMsByAddress.get(addressLower);
  return {
    address: display,
    uris,
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
  const window = orchestratorUpstreamWindowFromPeriod(opts?.period);
  return cachedFetch(`facade:orchestrators:${window}`, TTL.ORCHESTRATORS, async () => {
    const [dashRows, netData] = await Promise.all([
      naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window }, {
        cache: 'no-store',
        errorLabel: 'orchestrators',
      }),
      getNetOrchestratorDataSafe(),
    ]);

    const dashboardByLower = new Map<string, ApiOrchestrator>();
    const dashboardOrder: string[] = [];
    for (const r of dashRows) {
      const k = r.address.trim().toLowerCase();
      if (!k) continue;
      if (!dashboardByLower.has(k)) {
        dashboardByLower.set(k, r);
        dashboardOrder.push(k);
      }
    }

    const netKeys = [...netData.urisByAddress.keys()];
    const seenDash = new Set(dashboardOrder);
    const orderedKeys = [...dashboardOrder, ...netKeys.filter((k) => !seenDash.has(k))];

    const merged: DashboardOrchestrator[] = [];
    for (const addressLower of orderedKeys) {
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
