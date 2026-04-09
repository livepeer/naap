/**
 * BYOC worker summary resolver — NAAP API backed.
 *
 * Source: GET /v1/byoc/workers
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface BYOCWorkerSummary {
  capability: string;
  worker_count: number;
  models: string[];
  avg_price_per_unit: number;
}

export async function resolveBYOCWorkers(opts: {
  start: string;
  end: string;
}): Promise<BYOCWorkerSummary[]> {
  const org = getNaapOrg();
  const cacheKey = `facade:byoc-workers:${opts.start}:${opts.end}:${org ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.BATCH_SUMMARY, async () => {
    const params: Record<string, string> = { start: opts.start, end: opts.end };
    if (org) params.org = org;

    const res = await naapGet<{ data: BYOCWorkerSummary[] } | BYOCWorkerSummary[]>('byoc/workers', params, {
      cache: 'no-store',
      errorLabel: 'byoc-workers',
    });
    const rows = Array.isArray(res) ? res : (res as { data: BYOCWorkerSummary[] }).data ?? [];
    return Array.isArray(rows) ? rows : [];
  });
}
