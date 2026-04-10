import { type NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getJobsDemand } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const p = request.nextUrl.searchParams;
  const window = p.get('window') ?? '24h';
  const pipeline_id = p.get('pipeline_id') ?? undefined;
  const model_id = p.get('model_id') ?? undefined;
  const gateway = p.get('gateway') ?? undefined;
  const job_type = (p.get('job_type') ?? undefined) as 'ai-batch' | 'byoc' | undefined;
  const limit = Number(p.get('limit') ?? 50);
  const cursor = p.get('cursor') ?? undefined;
  const cacheKey = `jobs-demand:${window}:${pipeline_id ?? 'all'}:${job_type ?? 'all'}:${limit}:${cursor ?? ''}`;

  try {
    const { data, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getJobsDemand({ window, pipeline_id, model_id, gateway, job_type, limit, cursor }),
      'jobs-demand',
    );
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.JOBS));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[jobs/demand] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Jobs demand data is unavailable' } },
      { status: 503 },
    );
  }
}
