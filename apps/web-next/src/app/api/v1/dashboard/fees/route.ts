import { NextRequest, NextResponse } from 'next/server';
import { getDashboardFees } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const daysStr = params.get('days');
  const days = daysStr != null ? parseInt(daysStr, 10) : undefined;

  try {
    const result = await getDashboardFees({ days });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/fees] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Fees data is unavailable' } },
      { status: 503 }
    );
  }
}
