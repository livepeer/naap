/**
 * Net capacity resolver — NAAP API backed.
 *
 * Fetches GET /v1/net/capacity and returns a lookup of
 * `${pipeline}:${modelId}` → summed WarmOrchCount.
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

interface NetCapacityEntry {
  Pipeline?: string;
  ModelID?: string;
  WarmOrchCount?: number;
}

interface NetCapacityResponse {
  SnapshotTime?: string;
  Entries?: NetCapacityEntry[];
}

async function naapGet<T>(path: string): Promise<T> {
  const res = await fetch(naapApiUpstreamUrl(path), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/net-capacity] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function aggregateEntries(entries: NetCapacityEntry[]): Record<string, number> {
  const map = new Map<string, number>();

  for (const row of entries) {
    const pipeline = row.Pipeline?.trim() ?? '';
    const modelId = row.ModelID?.trim() ?? '';
    if (!pipeline) continue;

    const warm = Number(row.WarmOrchCount ?? 0);
    const key = `${pipeline}:${modelId}`;
    map.set(key, (map.get(key) ?? 0) + warm);
  }

  return Object.fromEntries(map.entries());
}

export async function resolveNetCapacity(): Promise<Record<string, number>> {
  return cachedFetch('facade:net-capacity', TTL.PRICING * 1000, async () => {
    const body = await naapGet<NetCapacityResponse | NetCapacityEntry[]>('net/capacity');
    const entries: NetCapacityEntry[] = Array.isArray(body)
      ? body
      : Array.isArray(body.Entries)
        ? body.Entries
        : [];
    return aggregateEntries(entries);
  });
}
