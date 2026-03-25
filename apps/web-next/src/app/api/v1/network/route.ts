import { NextRequest, NextResponse } from 'next/server';
import { resolveKPI } from '@/lib/dashboard/resolvers';
import type { NetworkSummary } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const timeframe = request.nextUrl.searchParams.get('timeframe') ?? '18';

  try {
    const kpi = await resolveKPI({ timeframe });

    const body: NetworkSummary = {
      timeframe_hours: kpi.timeframeHours,
      success_rate: kpi.successRate.value,
      active_providers: kpi.orchestratorsOnline.value,
      usage_mins: kpi.dailyUsageMins.value,
      sessions: kpi.dailySessionCount.value,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/network] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network data is unavailable' } },
      { status: 503 },
    );
  }
}
