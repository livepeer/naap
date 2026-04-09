/**
 * AI batch job records resolver — NAAP API backed.
 * Not cached — paginated per-request data.
 *
 * Source: GET /v1/ai-batch/jobs
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
}

export async function resolveAIBatchJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  offset?: number;
}): Promise<AIBatchJobRecord[]> {
  const org = getNaapOrg();
  const params: Record<string, string> = {
    start: opts.start,
    end: opts.end,
    limit: String(Math.min(opts.limit ?? 50, 1000)),
    offset: String(opts.offset ?? 0),
  };
  if (org) params.org = org;

  const res = await naapGet<{ data: AIBatchJobRecord[] } | AIBatchJobRecord[]>('ai-batch/jobs', params, {
    cache: 'no-store',
    errorLabel: 'ai-batch-jobs',
  });
  const rows = Array.isArray(res) ? res : (res as { data: AIBatchJobRecord[] }).data ?? [];
  return Array.isArray(rows) ? rows : [];
}
