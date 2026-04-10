/**
 * GPU Capacity resolver -- NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/gpu-capacity which returns GPU hardware
 * inventory grouped by pipeline/model from the latest capability snapshots
 * (last 10 minutes). This endpoint does not accept time-range parameters.
 *
 * Source:
 *   GET /v1/dashboard/gpu-capacity
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveGPUCapacity(_opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  return cachedFetch('facade:gpu-capacity', TTL.GPU_CAPACITY, () =>
    naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity', {}, {
      cache: 'no-store',
      errorLabel: 'gpu-capacity',
    })
  );
}
