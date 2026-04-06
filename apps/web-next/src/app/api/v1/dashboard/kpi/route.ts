import { NextRequest, NextResponse } from 'next/server';
import { getDashboardKPI } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? '24';

  try {
    const result = await getDashboardKPI({ timeframe });
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'public, s-maxage=180, stale-while-revalidate=300');
    return res;
  } catch (err) {
    console.error('[dashboard/kpi] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'KPI data is unavailable' } },
      { status: 503 }
    );
  }
}
