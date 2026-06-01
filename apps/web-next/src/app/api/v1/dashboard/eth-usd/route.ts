import { NextResponse } from 'next/server';
import { getEthUsdOracle } from '@/lib/prices/eth-usd-oracle';
import { bffStaleWhileRevalidate } from '@/lib/api/bff-swr';
import { TTL, dashboardRouteCacheControl } from '@/lib/facade/cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/v1/dashboard/eth-usd
 *
 * USD per 1 ETH for pipeline price estimates. Separate from GraphQL so the
 * dashboard UI stays compatible with older dashboard-provider bundles.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { data: ethUsd, cache } = await bffStaleWhileRevalidate(
      'dashboard:eth-usd',
      () => getEthUsdOracle(),
      'eth-usd',
    );
    const res = NextResponse.json({ ethUsd });
    res.headers.set('Cache-Control', dashboardRouteCacheControl(TTL.PRICING));
    res.headers.set('X-Cache', cache);
    return res;
  } catch (err) {
    console.error('[dashboard/eth-usd] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'ETH/USD reference is unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5' } },
    );
  }
}
