/**
 * GPU Capacity resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/gpu-capacity which returns GPU hardware
 * inventory grouped by pipeline/model from capability snapshots. The endpoint
 * reflects orchestrators active in the last 30 minutes and does not
 * accept a `window` parameter.
 *
 * The response includes `activeGPUs` (distinct GPUs currently serving streams)
 * and `availableCapacity` (totalGPUs - activeGPUs).
 *
 * Source:
 *   GET /v1/dashboard/gpu-capacity
 */

import type { DashboardGPUCapacity } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveGPUCapacity(): Promise<DashboardGPUCapacity> {
  return cachedFetch('facade:gpu-capacity', TTL.GPU_CAPACITY, async () => {
    return naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity', undefined, {
      cache: 'no-store',
      errorLabel: 'gpu-capacity',
    });
  });
}
