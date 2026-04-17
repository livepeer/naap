/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/kpi (combined `streaming` + `requests` on API v1),
 * then overrides orchestratorsOnline.value using streaming + requests orchestrator
 * inventory (shared cached fetch).
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=…[&pipeline=…&model_id=…] — `window` is OpenAPI
 *   `DashboardWindow` (e.g. 24h, 7d); BFF accepts `timeframe` in hours only.
 *   GET /v1/streaming/orchestrators + GET /v1/requests/orchestrators (shared, cached)
 */

import type { DashboardKPIWithRequests } from '@naap/plugin-sdk';
import { dashboardUpstreamTimeoutMs, formatDashboardWindow } from '../dashboard-window.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { parseDashboardKpiWithRequests } from '../upstream-parse.js';
import {
  getNetOrchestratorDataSafe,
  hasNonBlankServiceUri,
  type NetOrchestratorData,
} from './net-orchestrators.js';

/** Clamp a raw timeframe string to a canonical hours value in [1, 168]. */
export function normalizeTimeframeHours(timeframe?: string): number {
  const parsed = parseInt(timeframe ?? '24', 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
}

/** KPI-only: listed orchestrators with registry evidence they were seen within the window. */
function orchestratorKpiCountForTimeframe(
  netData: NetOrchestratorData,
  hours: number,
): number {
  if (!netData.hasLastSeenData) {
    return netData.listedCount;
  }
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
  let n = 0;
  for (const [addrLower, uris] of netData.urisByAddress) {
    if (!hasNonBlankServiceUri(uris)) {
      continue;
    }
    const lastMs = netData.lastSeenMsByAddress.get(addrLower);
    if (lastMs !== undefined && lastMs >= cutoffMs) {
      n++;
    }
  }
  return n;
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

    const merged = parseDashboardKpiWithRequests(rawBody);

    const hasNetRegistrySnapshot =
      netData.listedCount > 0 ||
      netData.activeCount > 0 ||
      netData.urisByAddress.size > 0;
    if (hasNetRegistrySnapshot) {
      merged.orchestratorsOnline = {
        ...merged.orchestratorsOnline,
        value: orchestratorKpiCountForTimeframe(netData, hours),
      };
    }

    return merged;
  });
}
