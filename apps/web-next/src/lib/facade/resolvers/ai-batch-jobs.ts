/**
 * AI batch job records resolver — NAAP API backed.
 * Not cached — paginated per-request data.
 *
 * Source: GET /v1/ai-batch/jobs?start=...&end=...&limit=N[&cursor=...]
 * Response: { data: [...], pagination: { next_cursor?, has_more, page_size }, meta: {} }
 */

import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface AIBatchJobRecord {
  request_id: string;
  org: string;
  gateway?: string;
  pipeline: string;
  model_id?: string;
  completed_at: string;
  success?: boolean | null;
  tries?: number;
  duration_ms?: number;
  orch_url?: string;
  latency_score?: number;
  price_per_unit?: number;
  error_type?: string;
  error?: string;
  gpu_model?: string;
  attribution_status?: string;
}

interface AIBatchJobsResponse {
  data: AIBatchJobRecord[];
  pagination: { next_cursor?: string; has_more: boolean; page_size: number };
}

export async function resolveAIBatchJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  cursor?: string;
}): Promise<AIBatchJobRecord[]> {
  const org = getNaapOrg();
  const params: Record<string, string> = {
    start: opts.start,
    end: opts.end,
    limit: String(Math.min(opts.limit ?? 50, 1000)),
  };
  if (opts.cursor) params.cursor = opts.cursor;
  if (org) params.org = org;

  const res = await naapGet<AIBatchJobsResponse>('ai-batch/jobs', params, {
    cache: 'no-store',
    errorLabel: 'ai-batch-jobs',
  });
  return res.data ?? [];
}
