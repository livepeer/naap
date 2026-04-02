import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import { jsonJobFeedResponse } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const streams = await getDashboardJobFeed();
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
