import { NextRequest, NextResponse } from 'next/server';
import { getLiveVideoCapacity } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const modelsParam = request.nextUrl.searchParams.get('models')?.trim() ?? '';
  const models = modelsParam
    ? modelsParam.split(',').map((m) => m.trim()).filter(Boolean)
    : [];

  if (models.length === 0) {
    return NextResponse.json({ capacityByModel: {} });
  }

  try {
    const capacityByModel = await getLiveVideoCapacity(models);
    return NextResponse.json({ capacityByModel });
  } catch (err) {
    console.error('[network/live-video-capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Live video capacity data is unavailable' } },
      { status: 503 },
    );
  }
}
