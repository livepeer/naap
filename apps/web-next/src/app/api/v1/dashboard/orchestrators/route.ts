import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getDashboardOrchestrators } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const period = params.get('period')?.trim() || '24h';
  const cacheKey = `orchestrators:${period}`;

  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getDashboardOrchestrators({ period }),
      'orchestrators'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.ORCHESTRATORS));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/orchestrators] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrators data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
