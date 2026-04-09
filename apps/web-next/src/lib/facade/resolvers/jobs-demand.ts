/**
 * Jobs demand resolver — NAAP API backed.
 *
 * Source: GET /v1/jobs/demand
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

export interface Pagination {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

export interface JobsDemandResponse {
  demand: JobsDemandRow[];
  pagination: Pagination;
}

export async function resolveJobsDemand(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  gateway?: string;
  job_type?: 'ai-batch' | 'byoc';
  page?: number;
  page_size?: number;
}): Promise<JobsDemandResponse> {
  const window = opts.window ?? '24h';
  const page = opts.page ?? 1;
  const page_size = opts.page_size ?? 50;
  const org = getNaapOrg();
  const cacheKey = `facade:jobs-demand:${window}:${org ?? 'all'}:${opts.pipeline_id ?? 'all'}:${opts.job_type ?? 'all'}:${page}:${page_size}`;

  return cachedFetch(cacheKey, TTL.JOBS, async () => {
    const params: Record<string, string> = {
      window,
      page: String(page),
      page_size: String(page_size),
    };
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
