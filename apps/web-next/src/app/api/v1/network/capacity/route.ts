import { NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getNetCapacity } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

export async function GET(): Promise<NextResponse> {
  try {
    const { data: capacityByPipelineModel, cache } = await bffStaleWhileRevalidate(
      'net-capacity',
      () => getNetCapacity(),
      'net-capacity'
    );
    const res = jsonWithOverviewCache({ capacityByPipelineModel }, OverviewHttpCacheSec.netCapacity);
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[network/capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network capacity data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } },
    );
  }
}
