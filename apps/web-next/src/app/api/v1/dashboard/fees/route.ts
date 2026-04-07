import { NextRequest, NextResponse } from 'next/server';
import { getDashboardFees } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const daysStr = params.get('days');
  let days: number | undefined;
  if (daysStr !== null) {
    const trimmed = daysStr.trim();
    if (!/^\d+$/.test(trimmed)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Invalid days: must be a non-negative integer string' } },
        { status: 400 },
      );
    }
    const parsed = parseInt(trimmed, 10);
    if (parsed < 7 || parsed > 365) {
      return NextResponse.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid days: must be an integer between 7 and 365',
          },
        },
        { status: 400 },
      );
    }
    days = parsed;
  }

  try {
    // No bffStaleWhileRevalidate: the subgraph resolver fetches with
    // cache: 'no-store' for freshness; HTTP Cache-Control (browser 60s +
    // CDN s-maxage) is sufficient without a Redis SWR envelope.
    const result = await getDashboardFees({ days });
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.FEES));
    return res;
  } catch (err) {
    console.error('[dashboard/fees] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Fees data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
