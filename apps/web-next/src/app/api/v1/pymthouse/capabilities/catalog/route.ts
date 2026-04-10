/**
 * GET /api/v1/pymthouse/capabilities/catalog
 *
 * PymtHouse plan builder: pipelines/models from NAAP facade (stable contract v1).
 * Query: limit — max network models to include (default 200, max 500).
 */

import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { buildCapabilitiesCatalog, newCorrelationId, pymthouseIntegrationError } from '@/lib/pymthouse-plan-builder';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlation_id = newCorrelationId();
  const limitParam = request.nextUrl.searchParams.get('limit');
  const parsed = limitParam != null ? parseInt(limitParam, 10) : NaN;
  const networkModelsLimit = Number.isFinite(parsed) ? parsed : 200;

  try {
    const cacheKey = `pymthouse-capabilities-catalog:${networkModelsLimit}`;
    const { data: result, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => buildCapabilitiesCatalog({ networkModelsLimit }),
      'pymthouse-capabilities-catalog'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PIPELINE_CATALOG));
    res.headers.set('X-Cache', cache);
    res.headers.set('X-Correlation-Id', correlation_id);
    return res;
  } catch (err) {
    console.error('[pymthouse/capabilities/catalog] error:', err);
    return NextResponse.json(
      pymthouseIntegrationError(
        'service_unavailable',
        'Capabilities catalog is unavailable.',
        correlation_id
      ),
      {
        status: 503,
        headers: {
          'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0',
          'X-Correlation-Id': correlation_id,
        },
      }
    );
  }
}
