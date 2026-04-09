/**
 * BYOC job summary resolver — NAAP API backed.
 *
 * Source: GET /v1/byoc/summary
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface BYOCJobSummary {
  capability: string;
  total_jobs: number;
  success_rate: number;
  avg_duration_ms: number;
}

export async function resolveBYOCSummary(opts: {
  start: string;
  end: string;
}): Promise<BYOCJobSummary[]> {
  const org = getNaapOrg();
  const cacheKey = `facade:byoc-summary:${opts.start}:${opts.end}:${org ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.BATCH_SUMMARY, async () => {
    const params: Record<string, string> = { start: opts.start, end: opts.end };
    if (org) params.org = org;

    const res = await naapGet<{ data: BYOCJobSummary[] } | BYOCJobSummary[]>('byoc/summary', params, {
      cache: 'no-store',
      errorLabel: 'byoc-summary',
    });
    const rows = Array.isArray(res) ? res : (res as { data: BYOCJobSummary[] }).data ?? [];
    return Array.isArray(rows) ? rows : [];
  });
}
