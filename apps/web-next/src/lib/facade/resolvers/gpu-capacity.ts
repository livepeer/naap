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
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

async function naapGet<T>(path: string): Promise<T> {
  const res = await fetch(naapApiUpstreamUrl(path), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/gpu-capacity] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolveGPUCapacity(_opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  return cachedFetch('facade:gpu-capacity', TTL.GPU_CAPACITY * 1000, () =>
    naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity')
  );
}
