import { type NextRequest, NextResponse } from 'next/server';
import { getBYOCJobs } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const p = request.nextUrl.searchParams;
  const start = p.get('start') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const end = p.get('end') ?? new Date().toISOString();
  const limit = Math.min(Number(p.get('limit') ?? 50), 1000);
  const cursor = p.get('cursor') ?? undefined;

  try {
    const data = await getBYOCJobs({ start, end, limit, cursor });
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    console.error('[byoc/jobs] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'BYOC jobs are unavailable' } },
      { status: 503 },
    );
  }
}
