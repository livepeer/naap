/**
 * Job feed resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/job-feed which returns currently active streams
 * pre-deduplicated and ordered by most recently seen, including durationSeconds,
 * orchestratorAddress, and job_type.
 *
 * Source:
 *   GET /v1/dashboard/job-feed?limit=N
 */

import type { JobFeedItem } from '../types.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Round to 2 decimal places. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function resolveJobFeed(opts: { limit?: number }): Promise<JobFeedItem[]> {
  const limit = opts.limit ?? 50;
  return cachedFetch(`facade:job-feed:${limit}`, TTL.JOB_FEED, async () => {
    const rows = await naapGet<JobFeedItem[]>('dashboard/job-feed', { limit: String(limit) }, {
      cache: 'no-store',
      errorLabel: 'job-feed',
    });

    return rows.map((r) => ({
      ...r,
      inputFps: r2(r.inputFps),
      outputFps: r2(r.outputFps),
      durationSeconds: r.durationSeconds != null ? r2(r.durationSeconds) : undefined,
    }));
  });
}
