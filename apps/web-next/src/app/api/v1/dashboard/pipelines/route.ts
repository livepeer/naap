import { NextRequest, NextResponse } from 'next/server';
import { resolvePipelines } from '@/lib/dashboard/resolvers';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? undefined;
  const limitStr = params.get('limit');
  const limit = limitStr != null ? parseInt(limitStr, 10) : 5;

  try {
    const result = await resolvePipelines({ timeframe, limit: isNaN(limit) ? 5 : limit });
    return jsonWithOverviewCache(result, OverviewHttpCacheSec.pipelines);
  } catch (err) {
    console.error('[dashboard/pipelines] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipelines data is unavailable' } },
      { status: 503 }
    );
  }
}
