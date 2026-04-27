/**
 * Shared raw data layer — the /v1/net/models endpoint fetched once and
 * cached in memory. The network-models resolver reads from this cache.
 *
 * Source:
 *   GET /v1/net/models?limit=200 → NetworkModel[]
 */

import type { NetworkModel } from './types.js';
import { cachedFetch, TTL } from './cache.js';
import { naapGet } from './naap-get.js';

/**
 * All pipeline/model rows from /v1/net/models.
 * Used by the network-models resolver.
 */
export function getRawNetModels(): Promise<NetworkModel[]> {
  const revalidateSec = Math.floor(TTL.NET_MODELS / 1000);
  return cachedFetch('facade:raw:net-models', TTL.NET_MODELS, () =>
    naapGet<NetworkModel[]>('net/models', { limit: '200' }, {
      next: { revalidate: revalidateSec },
      errorLabel: 'network-data',
    })
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
