/**
 * Net capacity resolver — derived from merged streaming + requests model rows.
 *
 * Returns `${pipeline}:${modelId}` → summed warm orchestrator count.
 */

import { cachedFetch, TTL } from '../cache.js';
import { getRawNetModels } from '../network-data.js';

export async function resolveNetCapacity(): Promise<Record<string, number>> {
  return cachedFetch('facade:net-capacity', TTL.NET_CAPACITY, async () => {
    const models = await getRawNetModels().catch((err) => {
      console.warn('[facade/net-capacity] getRawNetModels failed; using empty model capacity:', err);
      return [];
    });
    const map = new Map<string, number>();
    for (const row of models) {
      const pipeline = row.Pipeline?.trim() ?? '';
      const modelId = row.Model?.trim() ?? '';
      if (!pipeline) continue;
      const warm = Number(row.WarmOrchCount ?? 0);
      if (!Number.isFinite(warm) || warm < 0) continue;
      const key = `${pipeline}:${modelId}`;
      map.set(key, (map.get(key) ?? 0) + warm);
    }
    return Object.fromEntries(map.entries());
  });
}
