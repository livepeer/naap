/**
 * AI batch LLM summary resolver — NAAP API backed.
 *
 * Source: GET /v1/ai-batch/llm/summary
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface AIBatchLLMSummary {
  model: string;
  total_requests: number;
  success_rate: number;
  avg_tokens_per_sec: number;
  avg_ttft_ms: number;
  avg_total_tokens: number;
}

export async function resolveAIBatchLLMSummary(opts: {
  start: string;
  end: string;
}): Promise<AIBatchLLMSummary[]> {
  const org = getNaapOrg();
  const cacheKey = `facade:ai-batch-llm-summary:${opts.start}:${opts.end}:${org ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.BATCH_SUMMARY, async () => {
    const params: Record<string, string> = { start: opts.start, end: opts.end };
    if (org) params.org = org;

    const res = await naapGet<{ data: AIBatchLLMSummary[] } | AIBatchLLMSummary[]>('ai-batch/llm/summary', params, {
      cache: 'no-store',
      errorLabel: 'ai-batch-llm-summary',
    });
    const rows = Array.isArray(res) ? res : (res as { data: AIBatchLLMSummary[] }).data ?? [];
    return Array.isArray(rows) ? rows : [];
  });
}
