/**
 * GPU Capacity resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/gpu-capacity which returns GPU hardware
 * inventory grouped by pipeline/model from capability snapshots (last 10 min).
 *
 * Source:
 *   GET /v1/dashboard/gpu-capacity
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveGPUCapacity(opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const window = `${hours}h`;
  const revalidateSec = Math.floor(TTL.GPU_CAPACITY / 1000);
  return cachedFetch(`facade:gpu-capacity:${hours}`, TTL.GPU_CAPACITY, () =>
    naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity', { window }, {
      next: { revalidate: revalidateSec },
      errorLabel: 'gpu-capacity',
    })
  );
}
