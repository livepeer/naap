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
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/kpi] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolveKPI(opts: { timeframe?: string }): Promise<DashboardKPI> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  return cachedFetch(`facade:kpi:${hours}`, TTL.KPI * 1000, () =>
    naapGet<DashboardKPI>('dashboard/kpi', { window: `${hours}h` })
  );
}
