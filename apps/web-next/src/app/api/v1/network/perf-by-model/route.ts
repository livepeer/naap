import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';
import { getPerfByModel } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const start = params.get('start')?.trim() ?? '';
  const end = params.get('end')?.trim() ?? '';

  if (!start || !end) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Both start and end query params are required.' } },
      { status: 400 },
    );
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'start and end must be valid ISO-8601 timestamps.',
        },
      },
      { status: 400 },
    );
  }
  if (startMs > endMs) {
    return NextResponse.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'start must be before or equal to end.',
        },
      },
      { status: 400 },
    );
  }

  try {
    // Normalize to hour precision to match the resolver's own hour-bucket cache key,
    // maximising Redis SWR hit rate when the client sends slightly different ISO strings.
    const startHour = new Date(startMs).toISOString().slice(0, 13);
    const endHour = new Date(endMs).toISOString().slice(0, 13);
    const cacheKey = `perf-by-model:${startHour}:${endHour}`;
    const { data: fpsByPipelineModel, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getPerfByModel({ start, end }),
      'perf-by-model'
    );
    const res = jsonWithOverviewCache({ fpsByPipelineModel }, OverviewHttpCacheSec.perfByModel);
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[network/perf-by-model] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Perf-by-model data is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } },
    );
  }
}

