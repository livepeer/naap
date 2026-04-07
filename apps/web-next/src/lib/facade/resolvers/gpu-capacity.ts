/**
 * GPU Capacity resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/gpu-capacity which returns GPU hardware
 * inventory grouped by pipeline/model from capability snapshots.
 *
 * The UI timeframe still drives KPI / pipelines; for this endpoint, long NAAP
 * `window` values (12h+) have been observed to collapse the breakdown to a
 * single dominant pipeline (e.g. live-video only). We therefore query a
 * shorter upstream window while the overview still labels the user’s period.
 *
 * Source:
 *   GET /v1/dashboard/gpu-capacity?window=Nh
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Upstream window (hours) — capped so multi-pipeline GPU rows are not dropped. */
function naapGpuCapacityWindowHours(uiHours: number): number {
  if (uiHours >= 12) return 6;
  return uiHours;
}

export async function resolveGPUCapacity(opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const uiHours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const naapHours = naapGpuCapacityWindowHours(uiHours);
  const window = `${naapHours}h`;
  return cachedFetch(`facade:gpu-capacity:naap${naapHours}h`, TTL.GPU_CAPACITY, () =>
    naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity', { window }, {
      cache: 'no-store',
      errorLabel: 'gpu-capacity',
    })
  );
}
