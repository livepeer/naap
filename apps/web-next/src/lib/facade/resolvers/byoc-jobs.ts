/**
 * BYOC job records resolver — NAAP API backed.
 * Not cached — paginated per-request data.
 *
 * Source: GET /v1/byoc/jobs?start=...&end=...&limit=N[&cursor=...]
 * Response: { data: [...], pagination: { next_cursor?, has_more, page_size }, meta: {} }
 */

import { naapGet } from '../naap-get.js';
import { getNaapOrg } from '../naap-org.js';

export interface BYOCJobRecord {
  request_id: string;
  org: string;
  capability: string;
  completed_at: string;
  success?: boolean | null;
  duration_ms?: number;
  http_status?: number;
  orch_address?: string;
  orch_url?: string;
  worker_url?: string;
  error?: string;
  gpu_model?: string;
  attribution_status?: string;
}

interface BYOCJobsResponse {
  data: BYOCJobRecord[];
  pagination: { next_cursor?: string; has_more: boolean; page_size: number };
}

export async function resolveBYOCJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  cursor?: string;
}): Promise<BYOCJobRecord[]> {
  const org = getNaapOrg();
  const params: Record<string, string> = {
    start: opts.start,
    end: opts.end,
    limit: String(Math.min(opts.limit ?? 50, 1000)),
  };
  if (opts.cursor) params.cursor = opts.cursor;
  if (org) params.org = org;

  const res = await naapGet<BYOCJobsResponse>('byoc/jobs', params, {
    cache: 'no-store',
    errorLabel: 'byoc-jobs',
  });
  return res.data ?? [];
}
