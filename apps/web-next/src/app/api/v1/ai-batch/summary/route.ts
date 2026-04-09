import { type NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { getAIBatchSummary } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const p = request.nextUrl.searchParams;
  const start = p.get('start') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const end = p.get('end') ?? new Date().toISOString();
  const cacheKey = `ai-batch-summary:${start.slice(0, 13)}:${end.slice(0, 13)}`;

  try {
    const { data, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => getAIBatchSummary({ start, end }),
      'ai-batch-summary',
    );
    const res = NextResponse.json(data);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.BATCH_SUMMARY));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[ai-batch/summary] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'AI batch summary is unavailable' } },
      { status: 503 },
    );
  }
}
