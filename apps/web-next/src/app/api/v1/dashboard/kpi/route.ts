import { NextRequest, NextResponse } from 'next/server';
import { getDashboardKPI } from '@/lib/facade';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? '24';
  const pipeline = params.get('pipeline') ?? undefined;
  const model_id = params.get('model_id') ?? undefined;

  try {
    const result = await getDashboardKPI({ timeframe, pipeline, model_id });
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.KPI));
    return res;
  } catch (err) {
    console.error('[dashboard/kpi] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'KPI data is unavailable' } },
      { status: 503 }
    );
  }
}
