/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/kpi which returns pre-aggregated KPI
 * metrics including period-over-period deltas and hourly time-series buckets.
 * Replaces /network/demand calls for better performance.
 *
 * Supports optional pipeline and model_id filters to get scoped metrics.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=Nh
 *   GET /v1/dashboard/kpi?window=Nh&pipeline={pipeline}&model_id={model}
 */

import type { DashboardKPI } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveKPI(opts: { 
  timeframe?: string;
  pipeline?: string;
  model_id?: string;
}): Promise<DashboardKPI> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const revalidateSec = Math.floor(TTL.KPI / 1000);
  
  // Build query params
  const params: Record<string, string> = { window: `${hours}h` };
  if (opts.pipeline) params.pipeline = opts.pipeline;
  if (opts.model_id) params.model_id = opts.model_id;
  
  // Build cache key including filters
  const cacheKey = `facade:kpi:${hours}:${opts.pipeline || 'all'}:${opts.model_id || 'all'}`;
  
  return cachedFetch(cacheKey, TTL.KPI, () =>
    naapGet<DashboardKPI>('dashboard/kpi', params, {
      next: { revalidate: revalidateSec },
      errorLabel: 'kpi',
    })
  );
}
