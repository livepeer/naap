import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  try {
    const streams = await getDashboardJobFeed();
    return NextResponse.json({
      streams,
      clickhouseConfigured: true,
      queryFailed: false,
    });
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    return NextResponse.json({
      streams: [],
      clickhouseConfigured: true,
      queryFailed: true,
    });
  }
}
