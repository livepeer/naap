import { NextResponse } from 'next/server';
import { getDashboardPricing } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDashboardPricing();
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res;
  } catch (err) {
    console.error('[dashboard/pricing] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline unit cost data is unavailable' } },
      { status: 503 }
    );
  }
}
