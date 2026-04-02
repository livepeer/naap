import { NextRequest, NextResponse } from 'next/server';
import { getDashboardOrchestrators } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const period = params.get('period')?.trim() || '24h';

  try {
    const result = await getDashboardOrchestrators({ period });
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res;
  } catch (err) {
    console.error('[dashboard/orchestrators] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrators data is unavailable' } },
      { status: 503 }
    );
  }
}
