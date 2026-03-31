import { NextResponse } from 'next/server';
import { getDashboardJobFeed } from '@/lib/facade';
import { isClickHouseEnvConfiguredForJobFeed } from '@/lib/dashboard/active-streams-clickhouse';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const revalidate = 10;

export async function GET(): Promise<NextResponse> {
  const clickhouseConfigured = isClickHouseEnvConfiguredForJobFeed();
  try {
    const streams = await getDashboardJobFeed();
    return NextResponse.json({
      streams,
      clickhouseConfigured: process.env.FACADE_USE_STUBS === 'true' ? true : clickhouseConfigured,
      queryFailed: false,
    });
  } catch (err) {
    console.error('[dashboard/job-feed] error:', err);
    return NextResponse.json({
      streams: [],
      clickhouseConfigured,
      queryFailed: true,
    });
  }
}
