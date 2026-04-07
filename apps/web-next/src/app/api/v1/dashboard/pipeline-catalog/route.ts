import { NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getDashboardPipelineCatalog } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      'pipeline-catalog',
      () => getDashboardPipelineCatalog(),
      'pipeline-catalog'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PIPELINE_CATALOG));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/pipeline-catalog] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline catalog is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
