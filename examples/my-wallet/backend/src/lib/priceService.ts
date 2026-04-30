/**
 * Price fetch + cache logic
 * Uses CoinGecko API with DB-backed cache
 */

import { prisma } from '../db/client.js';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface PriceData {
  lptUsd: number;
  ethUsd: number;
  fetchedAt: string;
}

/**
 * Get latest cached prices, falling back to fresh fetch
 */
export async function getPrices(): Promise<PriceData> {
  const cutoff = new Date(Date.now() - CACHE_TTL);

  const cached = await prisma.walletPriceCache.findMany({
    where: {
      symbol: { in: ['LPT', 'ETH'] },
      fetchedAt: { gte: cutoff },
    },
    orderBy: { fetchedAt: 'desc' },
    distinct: ['symbol'],
  });

  const lptCache = cached.find(c => c.symbol === 'LPT');
  const ethCache = cached.find(c => c.symbol === 'ETH');

  if (lptCache && ethCache) {
    return {
      lptUsd: Number(lptCache.priceUsd),
      ethUsd: Number(ethCache.priceUsd),
      fetchedAt: lptCache.fetchedAt.toISOString(),
    };
  }

  return fetchAndCachePrices();
}

/**
 * Fetch fresh prices from CoinGecko and store in cache
 */
export async function fetchAndCachePrices(): Promise<PriceData> {
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey;
    }

    const response = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=livepeer,ethereum&vs_currencies=usd`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const lptUsd = data?.livepeer?.usd ?? 0;
    const ethUsd = data?.ethereum?.usd ?? 0;
    const now = new Date();

    // Store in DB cache
    await Promise.all([
      prisma.walletPriceCache.create({
        data: { symbol: 'LPT', priceUsd: lptUsd, fetchedAt: now },
      }),
      prisma.walletPriceCache.create({
        data: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now },
      }),
    ]);

    return { lptUsd, ethUsd, fetchedAt: now.toISOString() };
  } catch (err) {
    console.error('Failed to fetch prices from CoinGecko:', err);

    // Return last known prices from DB
    const fallback = await prisma.walletPriceCache.findMany({
      where: { symbol: { in: ['LPT', 'ETH'] } },
      orderBy: { fetchedAt: 'desc' },
      distinct: ['symbol'],
    });

    return {
      lptUsd: Number(fallback.find(c => c.symbol === 'LPT')?.priceUsd ?? 0),
      ethUsd: Number(fallback.find(c => c.symbol === 'ETH')?.priceUsd ?? 0),
      fetchedAt: fallback[0]?.fetchedAt.toISOString() ?? new Date().toISOString(),
    };
  }
}
