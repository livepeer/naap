import { NextRequest, NextResponse } from 'next/server';
import { getDashboardOrchestrators } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const period = params.get('period')?.trim() || '24h';

  try {
    const result = await getDashboardOrchestrators({ period });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/orchestrators] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrators data is unavailable' } },
      { status: 503 }
    );
  }
}
