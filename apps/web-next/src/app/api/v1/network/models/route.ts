import { NextRequest, NextResponse } from 'next/server';
import { getNetworkModels } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const limitStr = params.get('limit');
  const parsed = limitStr != null ? parseInt(limitStr, 10) : NaN;
  const limit = Number.isFinite(parsed) && parsed >= 1
    ? Math.min(parsed, 200)
    : 50;

  try {
    const { models, total } = await getNetworkModels({ limit });
    return jsonWithOverviewCache(
      {
        models,
        count: models.length,
        total,
      },
      OverviewHttpCacheSec.networkModels,
    );
  } catch (err) {
    console.error('[network/models] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network models data is unavailable' } },
      { status: 503 }
    );
  }
}
