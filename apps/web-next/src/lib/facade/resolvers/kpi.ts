/**
 * KPI resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/kpi (combined `streaming` + `requests` on API v1).
 * `orchestratorsOnline` and other KPI fields come from the API response as-is.
 *
 * Source:
 *   GET /v1/dashboard/kpi?window=…[&pipeline=…&model_id=…] — `window` is OpenAPI
 *   `DashboardWindow` (e.g. 24h, 7d); BFF accepts `timeframe` in hours only.
 */

import type { DashboardKPIWithRequests } from '@naap/plugin-sdk';
import { dashboardUpstreamTimeoutMs, formatDashboardWindow } from '../dashboard-window.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { parseDashboardKpiWithRequests } from '../upstream-parse.js';

/** Clamp a raw timeframe string to a canonical hours value in [1, 168]. */
export function normalizeTimeframeHours(timeframe?: string): number {
  const parsed = parseInt(timeframe ?? '24', 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
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
    const rawBody = await naapGet<unknown>('dashboard/kpi', params, {
      cache: 'no-store',
      errorLabel: 'kpi',
      timeoutMs: dashboardUpstreamTimeoutMs(hours),
    });

    return parseDashboardKpiWithRequests(rawBody);
  });
}
