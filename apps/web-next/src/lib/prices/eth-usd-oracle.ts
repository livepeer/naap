/**
 * ETH/USD reference for dashboard pricing conversions.
 *
 * Order: recent Prisma cache (same store as wallet flows) → public exchange
 * spot (see public-exchange-spot.ts) → stale DB → ETH_USD_PRICE env (default 3000).
 */

import { prisma } from '@/lib/db';
import { fetchEthUsdFromPublicExchanges } from './public-exchange-spot.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

function parseEthUsdFromEnv(): number {
  const raw = process.env.ETH_USD_PRICE?.trim();
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3000;
  return n;
}

async function readCachedEthUsd(): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const row = await prisma.walletPriceCache.findFirst({
      where: { symbol: 'ETH', fetchedAt: { gte: cutoff } },
      orderBy: { fetchedAt: 'desc' },
    });
    const n = row != null ? Number(row.priceUsd) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* prisma unavailable in some contexts */
  }
  return null;
}

async function persistEthUsd(ethUsd: number): Promise<void> {
  try {
    const now = new Date();
    await prisma.walletPriceCache.upsert({
      where: { symbol_fetchedAt: { symbol: 'ETH', fetchedAt: now } },
      create: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now },
      update: { priceUsd: ethUsd },
    });
  } catch {
    /* ignore */
  }
}

async function readStaleEthUsd(): Promise<number | null> {
  try {
    const row = await prisma.walletPriceCache.findFirst({
      where: { symbol: 'ETH' },
      orderBy: { fetchedAt: 'desc' },
    });
    const n = row != null ? Number(row.priceUsd) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Best-effort ETH/USD (USD per 1 ETH) for server-side pricing displays.
 */
export async function getEthUsdOracle(): Promise<number> {
  const fresh = await readCachedEthUsd();
  if (fresh != null) return fresh;

  try {
    const live = await fetchEthUsdFromPublicExchanges();
    if (live != null) {
      void persistEthUsd(live);
      return live;
    }
  } catch {
    /* fall through */
  }

  const stale = await readStaleEthUsd();
  if (stale != null) return stale;

  return parseEthUsdFromEnv();
}
