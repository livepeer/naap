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
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch } from '../cache.js';

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`[facade/job-feed] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolveJobFeed(opts: { limit?: number }): Promise<JobFeedItem[]> {
  const limit = opts.limit ?? 50;
  return cachedFetch('facade:job-feed', 15 * 1000, () =>
    naapGet<JobFeedItem[]>('dashboard/job-feed', { limit: String(limit) })
  );
}
