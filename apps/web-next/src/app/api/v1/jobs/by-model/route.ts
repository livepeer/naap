import { type NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getJobsByModel } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const p = request.nextUrl.searchParams;
  const window = p.get('window') ?? '24h';
  const pipeline_id = p.get('pipeline_id') ?? undefined;
  const model_id = p.get('model_id') ?? undefined;
  const job_type = (p.get('job_type') ?? undefined) as 'ai-batch' | 'byoc' | undefined;
  const cacheKey = `jobs-by-model:${window}:${pipeline_id ?? 'all'}:${model_id ?? 'all'}:${job_type ?? 'all'}`;

  try {
    const { data, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getJobsByModel({ window, pipeline_id, model_id, job_type }),
      'jobs-by-model',
    );
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.JOBS));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[jobs/by-model] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Jobs-by-model data is unavailable' } },
      { status: 503 },
    );
  }
}
