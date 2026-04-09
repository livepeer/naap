/**
 * BYOC job records resolver — NAAP API backed.
 * Not cached — paginated per-request data.
 *
 * Source: GET /v1/byoc/jobs
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
}

export async function resolveBYOCJobs(opts: {
  start: string;
  end: string;
  limit?: number;
  offset?: number;
}): Promise<BYOCJobRecord[]> {
  const org = getNaapOrg();
  const params: Record<string, string> = {
    start: opts.start,
    end: opts.end,
    limit: String(Math.min(opts.limit ?? 50, 1000)),
    offset: String(opts.offset ?? 0),
  };
  if (org) params.org = org;

  const res = await naapGet<{ data: BYOCJobRecord[] } | BYOCJobRecord[]>('byoc/jobs', params, {
    cache: 'no-store',
    errorLabel: 'byoc-jobs',
  });
  const rows = Array.isArray(res) ? res : (res as { data: BYOCJobRecord[] }).data ?? [];
  return Array.isArray(rows) ? rows : [];
}
