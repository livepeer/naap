/**
 * Jobs SLA resolver — NAAP API backed.
 *
 * Source: GET /v1/jobs/sla?window=Nh&limit=N[&cursor=...]
 * Response: { data: [...], pagination: { next_cursor?, has_more, page_size }, meta: {} }
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';
import type { CursorPagination } from './jobs-demand.js';

export interface JobsSLARow {
  window_start: string;
  org?: string | null;
  orchestrator_address: string;
  pipeline_id: string;
  model_id?: string | null;
  gpu_id?: string | null;
  job_type: 'ai-batch' | 'byoc';
  job_count: number;
  success_count: number;
  success_rate: number;
  avg_duration_ms: number;
  sla_score?: number | null;
}

export interface JobsSLAResponse {
  data: JobsSLARow[];
  pagination: CursorPagination;
}

export async function resolveJobsSLA(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  orchestrator_address?: string;
  job_type?: 'ai-batch' | 'byoc';
  limit?: number;
  cursor?: string;
}): Promise<JobsSLAResponse> {
  const window = opts.window ?? '24h';
  const limit = opts.limit ?? 50;
  const org = getNaapOrg();
  const cacheKey = `facade:jobs-sla:${window}:${org ?? 'all'}:${opts.pipeline_id ?? 'all'}:${opts.job_type ?? 'all'}:${limit}:${opts.cursor ?? ''}`;

  return cachedFetch(cacheKey, TTL.JOBS, async () => {
    const params: Record<string, string> = {
      window,
      limit: String(limit),
    };
    if (opts.cursor) params.cursor = opts.cursor;
    if (org) params.org = org;
    if (opts.pipeline_id) params.pipeline_id = opts.pipeline_id;
    if (opts.model_id) params.model_id = opts.model_id;
    if (opts.orchestrator_address) params.orchestrator_address = opts.orchestrator_address;
    if (opts.job_type) params.job_type = opts.job_type;

    return naapGet<JobsSLAResponse>('jobs/sla', params, {
      cache: 'no-store',
      errorLabel: 'jobs-sla',
    });
  });
}
