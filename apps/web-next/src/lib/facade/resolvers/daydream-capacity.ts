/**
 * Daydream capacity resolver — api.daydream.live backed.
 *
 * For each model name, fetches GET https://api.daydream.live/v1/capacity?models=<model>
 * and returns a lookup of modelId → idleContainers.
 *
 * Used to surface live-video-to-video idle container counts in the Pipelines panel.
 * Each model is individually cached so a miss for one model does not invalidate others.
 */

import { cachedFetch, TTL } from '../cache.js';

const DAYDREAM_CAPACITY_BASE_URL = 'https://api.daydream.live/v1/capacity';

interface DaydreamCapacityResponse {
  idleContainers?: number;
}

const DAYDREAM_REVALIDATE_SEC = Math.floor(TTL.DAYDREAM_CAPACITY / 1000);

async function fetchOneModel(model: string): Promise<number> {
  return cachedFetch(`facade:daydream-capacity:${model}`, TTL.DAYDREAM_CAPACITY, async () => {
    const url = new URL(DAYDREAM_CAPACITY_BASE_URL);
    url.searchParams.set('models', model);
    const res = await fetch(url.toString(), { next: { revalidate: DAYDREAM_REVALIDATE_SEC } });
    if (!res.ok) {
      throw new Error(`[facade/daydream-capacity] returned HTTP ${res.status}`);
    }
    const data: DaydreamCapacityResponse = await res.json();
    if (
      data != null &&
      typeof data === 'object' &&
      typeof data.idleContainers === 'number' &&
      Number.isFinite(data.idleContainers)
    ) {
      return data.idleContainers;
    }
    if (data?.idleContainers !== undefined) {
      console.warn('[facade/daydream-capacity] malformed payload, idleContainers:', data.idleContainers);
    }
    return 0;
  });
}

export async function resolveDaydreamCapacity(models: string[]): Promise<Record<string, number>> {
  if (models.length === 0) return {};
  const entries = await Promise.all(
    models.map(async (model) => {
      try {
        const count = await fetchOneModel(model);
        return [model, count] as const;
      } catch (err) {
        console.error('[facade/daydream-capacity] failed to fetch capacity for model:', model, err);
        return [model, 0] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
