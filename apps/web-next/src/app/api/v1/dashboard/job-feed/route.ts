import type { NextRequest } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import {
  jobFeedCacheMaxAgeSec,
  jsonWithOverviewCache,
} from '@/lib/api/overview-http-cache';
import { mapApiRowToJobFeedEntry } from '@/lib/facade/map-job-feed-entry';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const pollParam = request.nextUrl.searchParams.get('pollMs');
  const pollMs = pollParam != null ? Number(pollParam) : null;
  const maxAgeSec = jobFeedCacheMaxAgeSec(pollMs);

  try {
    const raw = await getDashboardJobFeed();
    const streams = raw
      .map((row) => mapApiRowToJobFeedEntry(row as unknown))
      .filter((e): e is NonNullable<typeof e> => e != null);
    return jsonWithOverviewCache(
      {
        streams,
        clickhouseConfigured: true,
        queryFailed: false,
      },
      maxAgeSec,
    );
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    return jsonWithOverviewCache(
      {
        streams: [],
        clickhouseConfigured: true,
        queryFailed: true,
      },
      maxAgeSec,
    );
  }
}
