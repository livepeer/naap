/**
 * Job feed resolver — NAAP Dashboard API backed.
 *
 * Fetches GET /v1/dashboard/job-feed which returns currently active streams
 * pre-deduplicated and ordered by most recently seen, including durationSeconds.
 *
 * Source:
 *   GET /v1/dashboard/job-feed?limit=N
 */

import type { JobFeedItem } from '../types.js';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

export async function resolveJobFeed(opts: { limit?: number }): Promise<JobFeedItem[]> {
  const limit = opts.limit ?? 50;
  return cachedFetch(`facade:job-feed:${limit}`, TTL.JOB_FEED, () =>
    naapGet<JobFeedItem[]>('dashboard/job-feed', { limit: String(limit) }, {
      cache: 'no-store',
      errorLabel: 'job-feed',
    })
  );
}
