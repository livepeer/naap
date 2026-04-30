/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/kpi (combined `streaming` + `requests` on API v1), then
 * overrides `orchestratorsObserved.value` with the distinct `(Address, URI)` pair count
 * from the shared streaming/requests orchestrator snapshot. The orchestrator endpoints have no
 * timeframe filter, so this value is independent of the user-selected window — which
 * is why `orchestratorsWindowHours` is exposed alongside: it carries the effective
 * span implied by the oldest `LastSeen` in the snapshot so the UI can label the tile
 * accordingly (e.g. "last ~3h") instead of the global dashboard timeframe.
 *
 * Both fetches run in parallel; if orchestrator inventory fails the upstream KPI value
 * is preserved as-is.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=…[&pipeline=…&model_id=…] — `window` is OpenAPI
 *   `DashboardWindow` (e.g. 24h, 7d); BFF accepts `timeframe` in hours only.
 */

import type { DashboardKPIWithRequests } from '@naap/plugin-sdk';
import { OVERVIEW_TIMEFRAME_MAX_HOURS } from '@/lib/dashboard/overview-timeframe';
import { dashboardUpstreamTimeoutMs, formatDashboardWindow } from '../dashboard-window.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { parseDashboardKpiWithRequests } from '../upstream-parse.js';
import {
  getNetOrchestratorDataSafe,
  type NetOrchestratorData,
} from './net-orchestrators.js';

/** Clamp a raw timeframe string to a canonical hours value in [1, {@link OVERVIEW_TIMEFRAME_MAX_HOURS}]. */
export function normalizeTimeframeHours(timeframe?: string): number {
  const parsed = parseInt(timeframe ?? '24', 10);
  return Math.max(
    1,
    Math.min(Number.isFinite(parsed) ? parsed : 24, OVERVIEW_TIMEFRAME_MAX_HOURS),
  );
}

/**
 * Effective window (hours) implied by the orchestrator registry snapshot:
 * how far back the oldest `LastSeen` reaches. Rounded to one decimal; at least 1h.
 * `null` when the registry had no parseable timestamps.
 */
function orchestratorSnapshotWindowHours(netData: NetOrchestratorData): number | null {
  if (!netData.hasLastSeenData || netData.oldestLastSeenMs === undefined) {
    return null;
  }
  const ageMs = Date.now() - netData.oldestLastSeenMs;
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return null;
  }
  const hours = ageMs / 3_600_000;
  return Math.max(1, Math.round(hours * 10) / 10);
}

export async function resolveKPI(opts: {
  timeframe?: string;
  pipeline?: string;
  model_id?: string;
}): Promise<DashboardKPIWithRequests> {
  const hours = normalizeTimeframeHours(opts.timeframe);

  const params: Record<string, string> = { window: formatDashboardWindow(hours) };
  if (opts.pipeline) params.pipeline = opts.pipeline;
  if (opts.model_id) params.model_id = opts.model_id;

  const cacheKey = `facade:kpi:${hours}:${opts.pipeline || 'all'}:${opts.model_id || 'all'}`;

  return cachedFetch(cacheKey, TTL.KPI, async () => {
    const [rawBody, netData] = await Promise.all([
      naapGet<unknown>('dashboard/kpi', params, {
        cache: 'no-store',
        errorLabel: 'kpi',
        timeoutMs: dashboardUpstreamTimeoutMs(hours),
      }),
      getNetOrchestratorDataSafe(),
    ]);
    const kpi = parseDashboardKpiWithRequests(rawBody);

    const hasNetRegistrySnapshot =
      netData.listedCount > 0 || netData.lastSeenMsByPair.size > 0;
    if (hasNetRegistrySnapshot) {
      kpi.orchestratorsObserved = {
        ...kpi.orchestratorsObserved,
        value: netData.listedCount,
        delta: 0,
      };
      kpi.orchestratorsWindowHours = orchestratorSnapshotWindowHours(netData);
    }

    return kpi;
  });
}
