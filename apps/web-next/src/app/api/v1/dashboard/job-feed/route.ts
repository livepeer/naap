import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import { mapApiRowToJobFeedEntry } from '@/lib/facade/map-job-feed-entry';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await getDashboardJobFeed();
    const streams = raw
      .map((row) => mapApiRowToJobFeedEntry(row as unknown))
      .filter((e): e is NonNullable<typeof e> => e != null);
    const res = NextResponse.json({
      streams,
      clickhouseConfigured: true,
      queryFailed: false,
    });
    res.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return res;
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    return NextResponse.json({
      streams: [],
      clickhouseConfigured: true,
      queryFailed: true,
    });
  }
}
