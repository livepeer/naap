/**
 * Prices API Route
 * GET /api/v1/wallet/prices - Get cached LPT/USD and ETH/USD prices
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import {
  fetchEthUsdFromPublicExchanges,
  fetchLptUsdFromPublicExchanges,
} from '@/lib/prices/public-exchange-spot';

const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const cutoff = new Date(Date.now() - CACHE_TTL);
    const cached = await prisma.walletPriceCache.findMany({
      where: { symbol: { in: ['LPT', 'ETH'] }, fetchedAt: { gte: cutoff } },
      orderBy: { fetchedAt: 'desc' },
      distinct: ['symbol'],
    });

    const lpt = cached.find((c) => c.symbol === 'LPT');
    const eth = cached.find((c) => c.symbol === 'ETH');

    if (lpt && eth) {
      return success({
        lptUsd: Number(lpt.priceUsd),
        ethUsd: Number(eth.priceUsd),
        fetchedAt: lpt.fetchedAt.toISOString(),
      });
    }

    try {
      const [lptUsdRaw, ethUsdRaw] = await Promise.all([
        fetchLptUsdFromPublicExchanges(),
        fetchEthUsdFromPublicExchanges(),
      ]);
      const lptUsd = lptUsdRaw != null && Number.isFinite(lptUsdRaw) && lptUsdRaw > 0 ? lptUsdRaw : 0;
      const ethUsd = ethUsdRaw != null && Number.isFinite(ethUsdRaw) && ethUsdRaw > 0 ? ethUsdRaw : 0;
      const now = new Date();

      await Promise.all([
        prisma.walletPriceCache.create({ data: { symbol: 'LPT', priceUsd: lptUsd, fetchedAt: now } }),
        prisma.walletPriceCache.create({ data: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now } }),
      ]);

      return success({ lptUsd, ethUsd, fetchedAt: now.toISOString() });
    } catch {
      const fallback = await prisma.walletPriceCache.findMany({
        where: { symbol: { in: ['LPT', 'ETH'] } },
        orderBy: { fetchedAt: 'desc' },
        distinct: ['symbol'],
      });
      return success({
        lptUsd: Number(fallback.find((c) => c.symbol === 'LPT')?.priceUsd ?? 0),
        ethUsd: Number(fallback.find((c) => c.symbol === 'ETH')?.priceUsd ?? 0),
        fetchedAt: fallback[0]?.fetchedAt.toISOString() ?? new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Error fetching prices:', err);
    return errors.internal('Failed to fetch prices');
  }
}
