/**
 * AI batch summary resolver — NAAP API backed.
 *
 * Source: GET /v1/ai-batch/summary
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface AIBatchJobSummary {
  pipeline: string;
  total_jobs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_latency_score: number;
}

export async function resolveAIBatchSummary(opts: {
  start: string;
  end: string;
}): Promise<AIBatchJobSummary[]> {
  const org = getNaapOrg();
  const cacheKey = `facade:ai-batch-summary:${opts.start}:${opts.end}:${org ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.BATCH_SUMMARY, async () => {
    const params: Record<string, string> = { start: opts.start, end: opts.end };
    if (org) params.org = org;

    const res = await naapGet<{ data: AIBatchJobSummary[] } | AIBatchJobSummary[]>('ai-batch/summary', params, {
      cache: 'no-store',
      errorLabel: 'ai-batch-summary',
    });
    const rows = Array.isArray(res) ? res : (res as { data: AIBatchJobSummary[] }).data ?? [];
    return Array.isArray(rows) ? rows : [];
  });
}
