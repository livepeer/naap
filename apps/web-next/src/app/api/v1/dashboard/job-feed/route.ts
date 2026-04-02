import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import { jsonJobFeedResponse } from '@/lib/api/overview-http-cache';
import { mapApiRowToJobFeedEntry } from '@/lib/facade/map-job-feed-entry';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await getDashboardJobFeed();
    const streams = raw
      .map((row) => mapApiRowToJobFeedEntry(row as unknown))
      .filter((e): e is NonNullable<typeof e> => e != null);
    return jsonJobFeedResponse({
      streams,
      clickhouseConfigured: true,
      queryFailed: false,
    });
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    return jsonJobFeedResponse({
      streams: [],
      clickhouseConfigured: true,
      queryFailed: true,
    });
  }
}
