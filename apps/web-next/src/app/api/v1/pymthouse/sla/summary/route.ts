/**
 * GET /api/v1/pymthouse/sla/summary
 *
 * PymtHouse plan builder: KPI, GPU capacity, and perf-by-model aggregates.
 * Query: timeframe — KPI/GPU window hours label (same as dashboard KPI, default 24).
 *        perfDays — length of perf/by-model window in days (default 7, max 30).
 */

import { NextRequest, NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { buildSlaSummary, newCorrelationId, pymthouseIntegrationError } from '@/lib/pymthouse-plan-builder';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';
import { normalizeTimeframeHours } from '@/lib/facade/resolvers/kpi';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlation_id = newCorrelationId();
  const timeframe = request.nextUrl.searchParams.get('timeframe');
  const perfDaysRaw = request.nextUrl.searchParams.get('perfDays');
  const perfParsed = perfDaysRaw != null ? parseInt(perfDaysRaw, 10) : NaN;
  const perfDays = Number.isFinite(perfParsed) ? perfParsed : 7;
  const hours = normalizeTimeframeHours(timeframe ?? undefined);
  const cacheKey = `pymthouse-sla-summary:${hours}:${perfDays}`;

  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      cacheKey,
      () => buildSlaSummary({ timeframe, perfDays }),
      'pymthouse-sla-summary'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.KPI));
    res.headers.set('X-Cache', cache);
    res.headers.set('X-Correlation-Id', correlation_id);
    return res;
  } catch (err) {
    console.error('[pymthouse/sla/summary] error:', err);
    return NextResponse.json(
      pymthouseIntegrationError(
        'service_unavailable',
        'SLA summary data is unavailable.',
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
