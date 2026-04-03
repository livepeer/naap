import { NextRequest, NextResponse } from 'next/server';
import { getLiveVideoCapacity } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const modelsParam = request.nextUrl.searchParams.get('models')?.trim() ?? '';
  const models = modelsParam
    ? modelsParam.split(',').map((m) => m.trim()).filter(Boolean)
    : [];

  if (models.length === 0) {
    return jsonWithOverviewCache({ capacityByModel: {} }, OverviewHttpCacheSec.liveVideo);
  }

  try {
    const capacityByModel = await getLiveVideoCapacity(models);
    return jsonWithOverviewCache({ capacityByModel }, OverviewHttpCacheSec.liveVideo);
  } catch (err) {
    console.error('[network/live-video-capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Live video capacity data is unavailable' } },
      { status: 503 },
    );
  }
}
