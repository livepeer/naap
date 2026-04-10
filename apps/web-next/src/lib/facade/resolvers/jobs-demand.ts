/**
 * Jobs demand resolver — NAAP API backed.
 *
 * Source: GET /v1/jobs/demand?window=Nh&limit=N[&cursor=...]
 * Response: { data: [...], pagination: { next_cursor?, has_more, page_size }, meta: {} }
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface JobsDemandRow {
  window_start: string;
  org?: string | null;
  gateway: string;
  pipeline_id: string;
  model_id?: string | null;
  job_type: 'ai-batch' | 'byoc';
  job_count: number;
  success_count: number;
  success_rate: number;
  avg_duration_ms: number;
  total_minutes: number;
}

export interface CursorPagination {
  next_cursor?: string;
  has_more: boolean;
  page_size: number;
}

export interface JobsDemandResponse {
  data: JobsDemandRow[];
  pagination: CursorPagination;
}

export async function resolveJobsDemand(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  gateway?: string;
  job_type?: 'ai-batch' | 'byoc';
  limit?: number;
  cursor?: string;
}): Promise<JobsDemandResponse> {
  const window = opts.window ?? '24h';
  const limit = opts.limit ?? 50;
  const org = getNaapOrg();
  const cacheKey = `facade:jobs-demand:${window}:${org ?? 'all'}:${opts.pipeline_id ?? 'all'}:${opts.job_type ?? 'all'}:${limit}:${opts.cursor ?? ''}`;

  return cachedFetch(cacheKey, TTL.JOBS, async () => {
    const params: Record<string, string> = {
      window,
      limit: String(limit),
    };
    if (opts.cursor) params.cursor = opts.cursor;
    if (org) params.org = org;
    if (opts.pipeline_id) params.pipeline_id = opts.pipeline_id;
    if (opts.model_id) params.model_id = opts.model_id;
    if (opts.gateway) params.gateway = opts.gateway;
    if (opts.job_type) params.job_type = opts.job_type;

    return naapGet<JobsDemandResponse>('jobs/demand', params, {
      cache: 'no-store',
      errorLabel: 'jobs-demand',
    });
  });
}
