/**
 * Network models resolver — NAAP API backed.
 *
 * Fetches GET /v1/net/models and maps directly to NetworkModel[].
 *
 * Source:
 *   GET /v1/net/models?limit=200 → model rows
 */

import type { NetworkModel } from '../types.js';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function naapGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/network-models] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveNetworkModels(opts: { limit?: number }): Promise<NetworkModel[]> {
  return cachedFetch('facade:network-models', TTL.NETWORK_MODELS * 1000, async () => {
    const rows = await naapGet<NetworkModel[]>('net/models', { limit: String(opts.limit ?? 200) });
    return rows;
  });
}
