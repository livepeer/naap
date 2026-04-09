/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Upstream `GET /v1/dashboard/kpi` returns **one pre-aggregated snapshot** for the
 * given scope (`window`, optional `pipeline`, optional `model_id`). It does **not**
 * support paging, cursors, or a `limit` parameter — the totals in that JSON already
 * span the full matching population for that scope. This resolver therefore must
 * **never** send `limit`/`offset` (or similar) to KPI; doing so would not trim the
 * result set and could confuse operators or future API versions.
 *
 * Fetches pre-aggregated KPI from that endpoint, then overrides
 * `orchestratorsOnline.value` using `GET /v1/net/orchestrators` (shared cached fetch):
 * distinct listed addresses (non-blank service URI) whose latest `LastSeen` falls
 * within the KPI window. When the registry omits `LastSeen`, falls back to the full
 * listed count (same rule as the orchestrator table). The overview table is unchanged
 * and still lists every listed address.
 *
 * Both fetches run in parallel; if net/orchestrators fails the upstream
 * KPI value is preserved as-is.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=Nh[&pipeline=...&model_id=...]
 *   GET /v1/net/orchestrators?active_only=false&limit=…&offset=…  (shared, cached, paged)
 */

import type { DashboardKPI } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
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
}): Promise<DashboardKPI> {
  const hours = normalizeTimeframeHours(opts.timeframe);

  const params: Record<string, string> = { window: `${hours}h` };
  if (opts.pipeline) params.pipeline = opts.pipeline;
  if (opts.model_id) params.model_id = opts.model_id;

  const cacheKey = `facade:kpi:${hours}:${opts.pipeline || 'all'}:${opts.model_id || 'all'}`;

  return cachedFetch(cacheKey, TTL.KPI, async () => {
    const [kpi, netData] = await Promise.all([
      naapGet<DashboardKPI>('dashboard/kpi', params, {
        cache: 'no-store',
        errorLabel: 'kpi',
      }),
      getNetOrchestratorDataSafe(),
    ]);

    const hasNetRegistrySnapshot =
      netData.listedCount > 0 ||
      netData.activeCount > 0 ||
      netData.urisByAddress.size > 0;
    if (hasNetRegistrySnapshot) {
      kpi.orchestratorsOnline = {
        ...kpi.orchestratorsOnline,
        value: orchestratorKpiCountForTimeframe(netData, hours),
      };
    }

    return kpi;
  });
}
