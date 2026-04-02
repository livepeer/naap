import { NextRequest, NextResponse } from 'next/server';
import { getDashboardKPI } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? '24';

  try {
    const result = await getDashboardKPI({ timeframe });
    return jsonWithOverviewCache(result, OverviewHttpCacheSec.kpi);
  } catch (err) {
    console.error('[dashboard/kpi] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'KPI data is unavailable' } },
      { status: 503 }
    );
  }
}
