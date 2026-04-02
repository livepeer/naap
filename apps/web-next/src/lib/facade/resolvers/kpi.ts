/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/kpi which returns pre-aggregated KPI
 * metrics including period-over-period deltas and hourly time-series buckets.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=Nh
 */

import type { DashboardKPI } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveKPI(opts: { timeframe?: string }): Promise<DashboardKPI> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const revalidateSec = Math.floor(TTL.KPI / 1000);
  return cachedFetch(`facade:kpi:${hours}`, TTL.KPI, () =>
    naapGet<DashboardKPI>('dashboard/kpi', { window: `${hours}h` }, {
      next: { revalidate: revalidateSec },
      errorLabel: 'kpi',
    })
  );
}
