/**
 * Jobs-by-model resolver — NAAP API backed.
 *
 * Source: GET /v1/jobs/by-model
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface JobModelPerformance {
  model_id: string;
  pipeline: string;
  job_type: 'ai-batch' | 'byoc';
  job_count: number;
  warm_orch_count: number;
  avg_duration_ms?: number | null;
  p50_duration_ms?: number | null;
  p99_duration_ms?: number | null;
}

export async function resolveJobsByModel(opts: {
  window?: string;
  pipeline_id?: string;
  model_id?: string;
  job_type?: 'ai-batch' | 'byoc';
}): Promise<JobModelPerformance[]> {
  const window = opts.window ?? '24h';
  const org = getNaapOrg();
  const cacheKey = `facade:jobs-by-model:${window}:${org ?? 'all'}:${opts.pipeline_id ?? 'all'}:${opts.model_id ?? 'all'}:${opts.job_type ?? 'all'}`;

  return cachedFetch(cacheKey, TTL.JOBS, async () => {
    const params: Record<string, string> = { window };
    if (org) params.org = org;
    if (opts.pipeline_id) params.pipeline_id = opts.pipeline_id;
    if (opts.model_id) params.model_id = opts.model_id;
    if (opts.job_type) params.job_type = opts.job_type;

    const rows = await naapGet<JobModelPerformance[]>('jobs/by-model', params, {
      cache: 'no-store',
      errorLabel: 'jobs-by-model',
    });
    return Array.isArray(rows) ? rows : [];
  });
}
