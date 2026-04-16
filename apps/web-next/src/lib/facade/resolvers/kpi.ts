/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches pre-aggregated KPI from GET /v1/dashboard/kpi which returns the
 * combined shape `{ streaming: DashboardKPI, requests: DashboardJobsOverview }`.
 * We extract `.streaming` for the dashboard KPI panel. All five KPI fields
 * (successRate, orchestratorsOnline, dailyUsageMins, dailySessionCount,
 * dailyNetworkFeesEth) return `{ value, delta }` from the API.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=Nh[&pipeline=...&model_id=...]
 */

import type { DashboardKPI, MetricDelta } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** combined response shape from /v1/dashboard/kpi */
interface DashboardKPICombined {
  streaming: DashboardKPI;
  requests?: unknown;
}

/** Round to 2 decimal places. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Round both value and delta to 2dp. */
function roundDelta(m: MetricDelta): MetricDelta {
  return { value: r2(m.value), delta: r2(m.delta) };
}

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
    const combined = await naapGet<DashboardKPICombined>('dashboard/kpi', params, {
      cache: 'no-store',
      errorLabel: 'kpi',
    });

    const s = combined.streaming;
    return {
      ...s,
      successRate: roundDelta(s.successRate),
      orchestratorsOnline: roundDelta(s.orchestratorsOnline),
      dailyUsageMins: roundDelta(s.dailyUsageMins),
      dailySessionCount: roundDelta(s.dailySessionCount),
      dailyNetworkFeesEth: roundDelta(s.dailyNetworkFeesEth),
    };
  });
}
