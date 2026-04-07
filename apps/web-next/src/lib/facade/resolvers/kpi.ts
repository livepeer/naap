/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches pre-aggregated KPI from GET /v1/dashboard/kpi, then overrides
 * orchestratorsOnline.value with the distinct-address count from
 * GET /v1/net/orchestrators (shared cached fetch) so the KPI tile and
 * the orchestrator table agree on the same source of truth.
 *
 * Both fetches run in parallel; if net/orchestrators fails the upstream
 * KPI value is preserved as-is.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=Nh[&pipeline=...&model_id=...]
 *   GET /v1/net/orchestrators  (shared, cached)
 */

import type { DashboardKPI } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNetOrchestratorDataSafe } from './net-orchestrators.js';

/** Clamp a raw timeframe string to a canonical hours value in [1, 168]. */
export function normalizeTimeframeHours(timeframe?: string): number {
  const parsed = parseInt(timeframe ?? '24', 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
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

    if (netData.activeCount > 0) {
      kpi.orchestratorsOnline = {
        ...kpi.orchestratorsOnline,
        value: netData.activeCount,
      };
    }

    return kpi;
  });
}
