import { NextRequest, NextResponse } from 'next/server';
import { resolveOrchestrators } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const period = params.get('period') ?? '24h';

  try {
    const result = await resolveOrchestrators({ period });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/orchestrators] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrators data is unavailable' } },
      { status: 503 }
    );
  }
}
