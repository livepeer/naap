import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getDashboardGPUCapacity } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? undefined;

  try {
    const tf = timeframe ?? 'default';
    const { data: result, cache } = await bffStaleWhileRevalidate(
      `gpu-capacity:${tf}`,
      () => getDashboardGPUCapacity({ timeframe }),
      'gpu-capacity'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.GPU_CAPACITY));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/gpu-capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'GPU capacity data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } }
    );
  }
}
