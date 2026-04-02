/**
 * Net capacity resolver — NAAP API backed.
 *
 * Fetches GET /v1/net/capacity and returns a lookup of
 * `${pipeline}:${modelId}` → summed WarmOrchCount.
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface NetCapacityEntry {
  Pipeline?: string;
  ModelID?: string;
  WarmOrchCount?: number;
}

interface NetCapacityResponse {
  SnapshotTime?: string;
  Entries?: NetCapacityEntry[];
}

function aggregateEntries(entries: NetCapacityEntry[]): Record<string, number> {
  const map = new Map<string, number>();

  for (const row of entries) {
    const pipeline = row.Pipeline?.trim() ?? '';
    const modelId = row.ModelID?.trim() ?? '';
    if (!pipeline) continue;

    const warm = Number(row.WarmOrchCount ?? 0);
    if (!Number.isFinite(warm) || warm < 0) continue;
    const key = `${pipeline}:${modelId}`;
    map.set(key, (map.get(key) ?? 0) + warm);
  }

  return Object.fromEntries(map.entries());
}

export async function resolveNetCapacity(): Promise<Record<string, number>> {
  return cachedFetch('facade:net-capacity', TTL.PRICING, async () => {
    const body = await naapGet<NetCapacityResponse | NetCapacityEntry[]>('net/capacity');
    const entries: NetCapacityEntry[] = Array.isArray(body)
      ? body
      : Array.isArray(body.Entries)
        ? body.Entries
        : [];
    return aggregateEntries(entries);
  });
}
