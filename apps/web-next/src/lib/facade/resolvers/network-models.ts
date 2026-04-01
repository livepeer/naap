/**
 * Network models resolver — NAAP API backed.
 *
 * Returns NetworkModel[] from the shared getRawNetModels() cache.
 *
 * Source:
 *   facade/network-data → GET /v1/net/models?limit=200
 */

import type { NetworkModel } from '../types.js';
import { getRawNetModels } from '../network-data.js';

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveNetworkModels(opts: { limit?: number }): Promise<NetworkModel[]> {
  const rows = await getRawNetModels();
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}
