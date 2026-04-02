import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  try {
    const streams = await getDashboardJobFeed();
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
