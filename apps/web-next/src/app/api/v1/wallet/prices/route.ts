/**
 * Prices API Route
 * GET /api/v1/wallet/prices - Get cached LPT/USD and ETH/USD prices
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const CACHE_TTL = 5 * 60 * 1000;
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

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

    const lpt = cached.find(c => c.symbol === 'LPT');
    const eth = cached.find(c => c.symbol === 'ETH');

    if (lpt && eth) {
      return success({
        lptUsd: Number(lpt.priceUsd),
        ethUsd: Number(eth.priceUsd),
        fetchedAt: lpt.fetchedAt.toISOString(),
      });
    }

    // Fetch fresh
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const apiKey = process.env.COINGECKO_API_KEY;
      if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

      const resp = await fetch(`${COINGECKO_BASE}/simple/price?ids=livepeer,ethereum&vs_currencies=usd`, { headers });
      const data = await resp.json();
      const lptUsd = data?.livepeer?.usd ?? 0;
      const ethUsd = data?.ethereum?.usd ?? 0;
      const now = new Date();

      await Promise.all([
        prisma.walletPriceCache.create({ data: { symbol: 'LPT', priceUsd: lptUsd, fetchedAt: now } }),
        prisma.walletPriceCache.create({ data: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now } }),
      ]);

      return success({ lptUsd, ethUsd, fetchedAt: now.toISOString() });
    } catch {
      // Return last known
      const fallback = await prisma.walletPriceCache.findMany({
        where: { symbol: { in: ['LPT', 'ETH'] } },
        orderBy: { fetchedAt: 'desc' },
        distinct: ['symbol'],
      });
      return success({
        lptUsd: Number(fallback.find(c => c.symbol === 'LPT')?.priceUsd ?? 0),
        ethUsd: Number(fallback.find(c => c.symbol === 'ETH')?.priceUsd ?? 0),
        fetchedAt: fallback[0]?.fetchedAt.toISOString() ?? new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Error fetching prices:', err);
    return errors.internal('Failed to fetch prices');
  }
}
