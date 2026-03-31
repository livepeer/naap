import { NextResponse } from 'next/server';
import { getDashboardPricing } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDashboardPricing();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/pricing] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline unit cost data is unavailable' } },
      { status: 503 }
    );
  }
}
