import { NextRequest, NextResponse } from 'next/server';
import { getDashboardKPI } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? '24';

  try {
    const result = await getDashboardKPI({ timeframe });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/kpi] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'KPI data is unavailable' } },
      { status: 503 }
    );
  }
}
