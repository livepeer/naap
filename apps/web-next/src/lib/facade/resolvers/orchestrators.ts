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
 * The dashboard API returns effectiveSuccessRate and noSwapRatio in 0–1 range;
 * those are scaled via `pct()` for UI display.
 *
 * The dashboard API returns slaScore and successRatio in 0–100 range; slaScore is
 * rounded via `Math.round(dash.slaScore)` and successRatio is rounded to 1 decimal.
 *
 * Source:
 *   GET /v1/dashboard/orchestrators?window=… — **capped at 24h** for upstream performance
 *     (wider UI timeframes still load the table; SLA metrics use at most the last 24h).
 *   GET /v1/streaming/orchestrators + GET /v1/requests/orchestrators (see net-orchestrators.ts)
 */

import type {
  DashboardOrchestrator,
  DashboardOrchestratorPipelineModelSla,
} from '@naap/plugin-sdk';
import { OVERVIEW_TIMEFRAME_MAX_HOURS } from '@/lib/dashboard/overview-timeframe';
import { formatDashboardWindow } from '../dashboard-window.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import {
  getNetOrchestratorDataSafe,
  hasNonBlankServiceUri,
} from './net-orchestrators.js';
import {
  resolveStreamingSla,
  type StreamingSlaAggregate,
} from './streaming-sla.js';

interface ApiOrchestrator {
  address: string;
  /** OpenAPI `serviceUri` — may be only URI when inventory rows omit `uri`. */
  serviceUri?: string;
  service_uri?: string;
  knownSessions: number;
  successSessions: number;
  successRatio: number | null;
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

/** Normalized key for deduping URIs (trim, lowercase, strip trailing slashes). */
function normalizeServiceUriKey(uri: string): string {
  return uri.trim().toLowerCase().replace(/\/+$/, '');
}

function mergeOrchestratorServiceUris(netUris: string[], dash: ApiOrchestrator): string[] {
  const out = [...netUris];
  const normalizedSeen = new Set(
    out.map((u) => normalizeServiceUriKey(u)).filter((k) => k.length > 0),
  );
  const extra =
    (typeof dash.serviceUri === 'string' && dash.serviceUri.trim()) ||
    (typeof dash.service_uri === 'string' && dash.service_uri.trim()) ||
    '';
  if (extra) {
    const key = normalizeServiceUriKey(extra);
    if (key.length > 0 && !normalizedSeen.has(key)) {
      normalizedSeen.add(key);
      out.push(extra);
    }
  }
  return out;
}

function pct(v: number | null): number | null {
  return v !== null ? Math.round(v * 1000) / 10 : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

type OrchestratorSlaMetrics = {
  knownSessions: number;
  successSessions: number;
  successRatio: number | null;
  effectiveSuccessRate: number | null;
  noSwapRatio: number | null;
  slaScore: number | null;
};

function dashboardHasUsableSla(dash: ApiOrchestrator): boolean {
  if (!Number.isFinite(dash.knownSessions) || dash.knownSessions <= 0) return false;
  return dash.successRatio != null
    && dash.effectiveSuccessRate != null
    && dash.noSwapRatio != null
    && dash.slaScore != null;
}

function shouldUseStreamingSla(
  dash: ApiOrchestrator,
  streaming: StreamingSlaAggregate | undefined,
): boolean {
  if (!streaming || streaming.knownSessions <= 0) return false;
  if (!dashboardHasUsableSla(dash)) return true;
  return streaming.knownSessions > dash.knownSessions;
}

function resolveSlaMetrics(
  dash: ApiOrchestrator,
  streaming: StreamingSlaAggregate | undefined,
): OrchestratorSlaMetrics {
  if (shouldUseStreamingSla(dash, streaming)) {
    return {
      knownSessions: streaming!.knownSessions,
      successSessions: streaming!.successSessions,
      successRatio: streaming!.successRatio,
      effectiveSuccessRate: streaming!.effectiveSuccessRate,
      noSwapRatio: streaming!.noSwapRatio,
      slaScore: streaming!.slaScore,
    };
  }
  /** No usable telemetry on either side: render '—' across SLA columns instead of '0%'. */
  if (!dashboardHasUsableSla(dash)) {
    return {
      knownSessions: dash.knownSessions ?? 0,
      successSessions: dash.successSessions ?? 0,
      successRatio: null,
      effectiveSuccessRate: null,
      noSwapRatio: null,
      slaScore: null,
    };
  }
  return {
    knownSessions: dash.knownSessions,
    successSessions: dash.successSessions,
    successRatio: dash.successRatio != null ? round1(dash.successRatio) : null,
    effectiveSuccessRate: pct(dash.effectiveSuccessRate),
    noSwapRatio: pct(dash.noSwapRatio),
    slaScore: dash.slaScore !== null ? Math.round(dash.slaScore) : null,
  };
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
  streamingSla: StreamingSlaAggregate | undefined,
  pipelineModelSla: DashboardOrchestratorPipelineModelSla[] | undefined,
): DashboardOrchestrator {
  const display = netData.displayAddressByLower.get(addressLower) ?? dash.address;
  const netUris = netData.urisByAddress.get(addressLower) ?? [];
  const uris = mergeOrchestratorServiceUris(netUris, dash);
  const rawOffers = netData.pipelineModelsByAddress.get(addressLower) ?? [];
  const pipelineModels = mergePipelineModels(dash.pipelineModels, rawOffers);
  const pipelineSet = new Set([...dash.pipelines, ...pipelineModels.map((o) => o.pipelineId)]);
  const lastSeenMs = netData.lastSeenMsByAddress.get(addressLower);
  const sla = resolveSlaMetrics(dash, streamingSla);
  return {
    address: display,
    uris,
    lastSeen: lastSeenMs !== undefined ? new Date(lastSeenMs).toISOString() : null,
    knownSessions: sla.knownSessions,
    successSessions: sla.successSessions,
    successRatio: sla.successRatio,
    effectiveSuccessRate: sla.effectiveSuccessRate,
    noSwapRatio: sla.noSwapRatio,
    slaScore: sla.slaScore,
    pipelines: [...pipelineSet],
    pipelineModels,
    pipelineModelSla,
    gpuCount: dash.gpuCount,
  };
}

function netOnlyPlaceholder(
  addressLower: string,
  netData: Awaited<ReturnType<typeof getNetOrchestratorDataSafe>>,
  streamingSla: StreamingSlaAggregate | undefined,
  pipelineModelSla: DashboardOrchestratorPipelineModelSla[] | undefined,
): DashboardOrchestrator {
  const pipelineModels = netData.pipelineModelsByAddress.get(addressLower) ?? [];
  const lastSeenMs = netData.lastSeenMsByAddress.get(addressLower);
  return {
    address: netData.displayAddressByLower.get(addressLower) ?? addressLower,
    uris: netData.urisByAddress.get(addressLower) ?? [],
    lastSeen: lastSeenMs !== undefined ? new Date(lastSeenMs).toISOString() : null,
    knownSessions: streamingSla?.knownSessions ?? 0,
    successSessions: streamingSla?.successSessions ?? 0,
    successRatio: streamingSla?.successRatio ?? null,
    effectiveSuccessRate: streamingSla?.effectiveSuccessRate ?? null,
    noSwapRatio: streamingSla?.noSwapRatio ?? null,
    slaScore: streamingSla?.slaScore ?? null,
    pipelines: pipelineModels.map((o) => o.pipelineId),
    pipelineModels,
    pipelineModelSla,
    gpuCount: 0,
  };
}

function dashboardServiceUrisEmpty(dash: ApiOrchestrator): boolean {
  const a = typeof dash.serviceUri === 'string' ? dash.serviceUri.trim() : '';
  const b = typeof dash.service_uri === 'string' ? dash.service_uri.trim() : '';
  return a.length === 0 && b.length === 0;
}

export async function resolveOrchestrators(opts?: { period?: string }): Promise<DashboardOrchestrator[]> {
  const window = orchestratorUpstreamWindowFromPeriod(opts?.period);
  // Merged registry + SLA; cached (TTL.ORCHESTRATORS) so the overview table is not recomputed on every dashboard poll.
  return cachedFetch(`facade:orchestrators:${window}`, TTL.ORCHESTRATORS, async () => {
    const [dashRows, netData, streamingSla] = await Promise.all([
      naapGet<ApiOrchestrator[]>('dashboard/orchestrators', { window }, {
        cache: 'no-store',
        errorLabel: 'orchestrators',
      }),
      getNetOrchestratorDataSafe(),
      resolveStreamingSla(),
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

    const netKeySet = new Set<string>([
      ...netData.urisByAddress.keys(),
      ...netData.pipelineModelsByAddress.keys(),
      ...netData.lastSeenMsByAddress.keys(),
      ...streamingSla.byOrchestrator.keys(),
      ...streamingSla.byOrchestratorCapability.keys(),
    ]);
    const seenDash = new Set(dashboardOrder);
    const extraNetKeys = [...netKeySet].filter((k) => !seenDash.has(k)).sort((a, b) => a.localeCompare(b));
    const orderedKeys = [...dashboardOrder, ...extraNetKeys];

    const mergedPairs: Array<{ addressLower: string; row: DashboardOrchestrator }> = [];
    for (const addressLower of orderedKeys) {
      const dash = dashboardByLower.get(addressLower);
      const byOrchestratorSla = streamingSla.byOrchestrator.get(addressLower);
      const byCapabilitySla = streamingSla.byOrchestratorCapability.get(addressLower);
      if (dash) {
        mergedPairs.push({
          addressLower,
          row: mapDashboardIntoNetRow(
            addressLower,
            dash,
            netData,
            byOrchestratorSla,
            byCapabilitySla,
          ),
        });
      } else {
        mergedPairs.push({
          addressLower,
          row: netOnlyPlaceholder(addressLower, netData, byOrchestratorSla, byCapabilitySla),
        });
      }
    }

    const merged = mergedPairs.map((p) => p.row);
    const beforeFilter = merged.length;
    const filtered = merged.filter((row) => hasNonBlankServiceUri(row.uris));
    const dropped = beforeFilter - filtered.length;

    let droppedNoDashboardNoNetUri = 0;
    for (const { addressLower, row } of mergedPairs) {
      if (hasNonBlankServiceUri(row.uris)) continue;
      const dash = dashboardByLower.get(addressLower);
      const netUris = netData.urisByAddress.get(addressLower) ?? [];
      const netHasUri = hasNonBlankServiceUri(netUris);
      if (dash) {
        if (dashboardServiceUrisEmpty(dash) && !netHasUri) {
          droppedNoDashboardNoNetUri += 1;
        }
      } else if (!netHasUri) {
        droppedNoDashboardNoNetUri += 1;
      }
    }

    if (dropped > 0) {
      console.warn(
        `[facade/orchestrators] merge: orderedKeys=${orderedKeys.length} beforeFilter=${beforeFilter} afterFilter=${filtered.length} dropped=${dropped} droppedNoServiceUriAndNoNetUri=${droppedNoDashboardNoNetUri}`,
      );
    }

    return filtered;
  });
}
