/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches pre-aggregated KPI from GET /v1/dashboard/kpi, then overrides
 * `orchestratorsOnline.value` with the distinct `(Address, URI)` pair count from the
 * shared /v1/net/orchestrators snapshot. The orchestrator list endpoint has no
 * timeframe filter, so this value is independent of the user-selected window — which
 * is why `orchestratorsWindowHours` is exposed alongside: it carries the effective
 * span implied by the oldest `LastSeen` in the snapshot so the UI can label the tile
 * accordingly (e.g. "last ~3h") instead of the global dashboard timeframe.
 *
 * Both fetches run in parallel; if net/orchestrators fails the upstream KPI value is
 * preserved as-is.
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
  type NetOrchestratorData,
} from './net-orchestrators.js';

/** Clamp a raw timeframe string to a canonical hours value in [1, 168]. */
export function normalizeTimeframeHours(timeframe?: string): number {
  const parsed = parseInt(timeframe ?? '24', 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
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
        value: netData.listedCount,
      };
      kpi.orchestratorsWindowHours = orchestratorSnapshotWindowHours(netData);
    }

    return kpi;
  });
}
