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

export async function resolveNetworkModels(opts: {
  limit?: number;
}): Promise<{ models: NetworkModel[]; total: number }> {
  const rows = await getRawNetModels();
  const total = rows.length;
  if (opts.limit === undefined) {
    return { models: rows, total };
  }
  const safeLimit = Math.max(0, Math.floor(opts.limit));
  return { models: rows.slice(0, safeLimit), total };
}
