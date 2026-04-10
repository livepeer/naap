/**
 * GET /api/v1/pymthouse/network/price
 *
 * PymtHouse plan builder: pipeline/model pricing hints from NAAP facade.
 * Response includes experimental: true — upstream semantics may evolve.
 */

import { NextResponse } from 'next/server';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { buildNetworkPricePayload, newCorrelationId, pymthouseIntegrationError } from '@/lib/pymthouse-plan-builder';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  const correlation_id = newCorrelationId();

  try {
    const { data: result, cache } = await bffStaleWhileRevalidate(
      'pymthouse-network-price',
      () => buildNetworkPricePayload(),
      'pymthouse-network-price'
    );
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PRICING));
    res.headers.set('X-Cache', cache);
    res.headers.set('X-Correlation-Id', correlation_id);
    return res;
  } catch (err) {
    console.error('[pymthouse/network/price] error:', err);
    return NextResponse.json(
      pymthouseIntegrationError(
        'service_unavailable',
        'Network price data is unavailable.',
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
