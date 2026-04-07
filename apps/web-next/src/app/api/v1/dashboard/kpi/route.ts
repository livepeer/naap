import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getDashboardKPI } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';
import { normalizeTimeframeHours } from '@/lib/facade/resolvers/kpi';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const hours = normalizeTimeframeHours(params.get('timeframe') ?? undefined);
  const timeframe = String(hours);
  const pipeline = params.get('pipeline') ?? undefined;
  const model_id = params.get('model_id') ?? undefined;
  const cacheKey = `kpi:${hours}:${pipeline ?? 'all'}:${model_id ?? 'all'}`;

  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getDashboardKPI({ timeframe, pipeline, model_id }),
      'kpi'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.KPI));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/kpi] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'KPI data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
