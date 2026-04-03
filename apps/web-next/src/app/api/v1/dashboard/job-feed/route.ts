import { type NextRequest, NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import { mapApiRowToJobFeedEntry } from '@/lib/facade/map-job-feed-entry';
import {
  JOB_FEED_BYPASS_CACHE_CONTROL,
  jobFeedCacheMaxAgeSec,
  jobFeedErrorCacheControl,
  jobFeedSuccessCacheControl,
} from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;
/** Upper bound aligned with {@link jobFeedCacheMaxAgeSec} (90s). */
export const revalidate = 90;

function parsePollMs(searchParams: URLSearchParams): number | undefined {
  const raw = searchParams.get('pollMs');
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const pollMs = parsePollMs(request.nextUrl.searchParams);
  const pollSec = jobFeedCacheMaxAgeSec(pollMs);
  const bypassCache =
    request.nextUrl.searchParams.get('refresh') === '1' ||
    request.nextUrl.searchParams.get('nocache') === '1';

  const cacheControl = bypassCache
    ? JOB_FEED_BYPASS_CACHE_CONTROL
    : jobFeedSuccessCacheControl(pollSec);

  try {
    const raw = await getDashboardJobFeed();
    const streams = raw
      .map((row) => mapApiRowToJobFeedEntry(row))
      .filter((e): e is NonNullable<typeof e> => e != null);
    const res = NextResponse.json({
      streams,
      clickhouseConfigured: true,
      queryFailed: false,
    });
    res.headers.set('Cache-Control', cacheControl);
    return res;
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    const errControl = bypassCache ? JOB_FEED_BYPASS_CACHE_CONTROL : jobFeedErrorCacheControl(pollSec);
    return NextResponse.json(
      {
        streams: [],
        clickhouseConfigured: true,
        queryFailed: true,
      },
      { headers: { 'Cache-Control': errControl } },
    );
  }
}
