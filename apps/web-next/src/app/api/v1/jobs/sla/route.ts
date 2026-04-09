import { type NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getJobsSLA } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const p = request.nextUrl.searchParams;
  const window = p.get('window') ?? '24h';
  const pipeline_id = p.get('pipeline_id') ?? undefined;
  const model_id = p.get('model_id') ?? undefined;
  const orchestrator_address = p.get('orchestrator_address') ?? undefined;
  const job_type = (p.get('job_type') ?? undefined) as 'ai-batch' | 'byoc' | undefined;
  const page = Number(p.get('page') ?? 1);
  const page_size = Number(p.get('page_size') ?? 50);
  const cacheKey = `jobs-sla:${window}:${pipeline_id ?? 'all'}:${job_type ?? 'all'}:${page}:${page_size}`;

  try {
    const { data, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getJobsSLA({ window, pipeline_id, model_id, orchestrator_address, job_type, page, page_size }),
      'jobs-sla',
    );
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.JOBS));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[jobs/sla] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Jobs SLA data is unavailable' } },
      { status: 503 },
    );
  }
}
