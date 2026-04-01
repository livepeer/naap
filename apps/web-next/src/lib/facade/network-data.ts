/**
 * Shared raw data layer — the /v1/net/models endpoint fetched once and
 * cached in memory. The network-models resolver reads from this cache.
 *
 * Source:
 *   GET /v1/net/models?limit=200 → NetworkModel[]
 */

import type { NetworkModel } from './types.js';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from './cache.js';

async function naapGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/network-data] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * All pipeline/model rows from /v1/net/models.
 * Used by the network-models resolver.
 */
export function getRawNetModels(): Promise<NetworkModel[]> {
  return cachedFetch('facade:raw:net-models', TTL.NET_MODELS * 1000, () =>
    naapGet<NetworkModel[]>('net/models', { limit: '200' })
  );
}

/**
 * Pre-warm the network models cache. Called from instrumentation.ts on startup
 * so the first real request is never cold.
 */
export async function warmNetworkData(): Promise<{ models: number }> {
  const models = await getRawNetModels();
  return { models: models.length };
}
