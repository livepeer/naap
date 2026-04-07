import { NextResponse } from 'next/server';
import { getDashboardProtocol } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    // No bffStaleWhileRevalidate: the subgraph resolver fetches with
    // cache: 'no-store' for freshness; HTTP Cache-Control (browser 60s +
    // CDN s-maxage) is sufficient without a Redis SWR envelope.
    const result = await getDashboardProtocol();
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PROTOCOL));
    return res;
  } catch (err) {
    console.error('[dashboard/protocol] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Protocol data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
