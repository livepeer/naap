import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getDashboardPipelines } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? undefined;
  const limitStr = params.get('limit');
  let limit: number | undefined;
  if (limitStr != null && limitStr !== '') {
    const n = parseInt(limitStr, 10);
    if (Number.isFinite(n) && n >= 1) {
      limit = n;
    }
  }
  const cacheKey = `pipelines:${timeframe ?? '24'}:${limit ?? 'all'}`;

  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getDashboardPipelines({ timeframe, limit }),
      'pipelines'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PIPELINES));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/pipelines] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipelines data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
