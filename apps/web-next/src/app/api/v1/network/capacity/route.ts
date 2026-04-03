import { NextResponse } from 'next/server';
import { getNetCapacity } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

export async function GET(): Promise<NextResponse> {
  try {
    const capacityByPipelineModel = await getNetCapacity();
    return jsonWithOverviewCache({ capacityByPipelineModel }, OverviewHttpCacheSec.netCapacity);
  } catch (err) {
    console.error('[network/capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network capacity data is unavailable' } },
      { status: 503 },
    );
  }
}
