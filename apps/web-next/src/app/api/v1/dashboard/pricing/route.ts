import { NextResponse } from 'next/server';
import { getDashboardPricing } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = OverviewHttpCacheSec.pricing;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDashboardPricing();
    return jsonWithOverviewCache(result, OverviewHttpCacheSec.pricing);
  } catch (err) {
    console.error('[dashboard/pricing] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline unit cost data is unavailable' } },
      { status: 503 }
    );
  }
}
