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

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/gpu-capacity] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolveGPUCapacity(opts: { timeframe?: string }): Promise<DashboardGPUCapacity> {
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const window = `${hours}h`;
  return cachedFetch(`facade:gpu-capacity:${hours}`, TTL.GPU_CAPACITY, () =>
    naapGet<DashboardGPUCapacity>('dashboard/gpu-capacity', { window })
  );
}
