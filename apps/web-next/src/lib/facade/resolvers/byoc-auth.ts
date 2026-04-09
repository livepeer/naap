/**
 * BYOC auth summary resolver — NAAP API backed.
 *
 * Source: GET /v1/byoc/auth
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface BYOCAuthSummary {
  capability: string;
  total_events: number;
  success_rate: number;
  failure_count: number;
}

export async function resolveBYOCAuth(opts: {
  start: string;
  end: string;
}): Promise<BYOCAuthSummary[]> {
  const org = getNaapOrg();
  const cacheKey = `facade:byoc-auth:${opts.start}:${opts.end}:${org ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.BATCH_SUMMARY, async () => {
    const params: Record<string, string> = { start: opts.start, end: opts.end };
    if (org) params.org = org;

    const res = await naapGet<{ data: BYOCAuthSummary[] } | BYOCAuthSummary[]>('byoc/auth', params, {
      cache: 'no-store',
      errorLabel: 'byoc-auth',
    });
    const rows = Array.isArray(res) ? res : (res as { data: BYOCAuthSummary[] }).data ?? [];
    return Array.isArray(rows) ? rows : [];
  });
}
