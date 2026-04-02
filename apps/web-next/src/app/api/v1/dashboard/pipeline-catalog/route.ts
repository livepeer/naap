import { NextResponse } from 'next/server';
import { getDashboardPipelineCatalog } from '@/lib/facade';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = OverviewHttpCacheSec.pipelineCatalog;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDashboardPipelineCatalog();
    return jsonWithOverviewCache(result, OverviewHttpCacheSec.pipelineCatalog);
  } catch (err) {
    console.error('[dashboard/pipeline-catalog] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline catalog is unavailable' } },
      { status: 503 }
    );
  }
}
