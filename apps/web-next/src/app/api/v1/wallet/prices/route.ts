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

/** Provenance for rows written from {@link fetchLptUsdFromPublicExchanges} / ETH twin. */
const WALLET_PRICE_SOURCE_PUBLIC_EXCHANGE = 'public_exchange';

function positiveUsd(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function maxFetchedAtIso(rows: { fetchedAt: Date }[]): string | null {
  if (!rows.length) return null;
  const t = Math.max(...rows.map((r) => r.fetchedAt.getTime()));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

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
      const lptUsd = positiveUsd(Number(lpt.priceUsd));
      const ethUsd = positiveUsd(Number(eth.priceUsd));
      return success({
        lptUsd,
        ethUsd,
        pricesAvailable: lptUsd != null && ethUsd != null,
        fetchedAt: lpt.fetchedAt.toISOString(),
      });
    }

    let lptUsdRaw: number | null = null;
    let ethUsdRaw: number | null = null;
    try {
      [lptUsdRaw, ethUsdRaw] = await Promise.all([
        fetchLptUsdFromPublicExchanges(),
        fetchEthUsdFromPublicExchanges(),
      ]);
    } catch (fetchErr) {
      console.error('[wallet/prices] Public exchange fetch failed:', fetchErr);
    }

    let lptUsd = positiveUsd(lptUsdRaw);
    let ethUsd = positiveUsd(ethUsdRaw);

    let fallbackRows: Awaited<ReturnType<typeof prisma.walletPriceCache.findMany>> = [];
    if (lptUsd == null || ethUsd == null) {
      fallbackRows = await prisma.walletPriceCache.findMany({
        where: { symbol: { in: ['LPT', 'ETH'] } },
        orderBy: { fetchedAt: 'desc' },
        distinct: ['symbol'],
      });
      if (lptUsd == null) {
        const row = fallbackRows.find((c) => c.symbol === 'LPT');
        lptUsd = positiveUsd(row != null ? Number(row.priceUsd) : null) ?? null;
      }
      if (ethUsd == null) {
        const row = fallbackRows.find((c) => c.symbol === 'ETH');
        ethUsd = positiveUsd(row != null ? Number(row.priceUsd) : null) ?? null;
      }
    }

    const lptLive = positiveUsd(lptUsdRaw);
    const ethLive = positiveUsd(ethUsdRaw);

    const now = new Date();
    const persist: Promise<unknown>[] = [];
    if (lptLive != null) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol: 'LPT' },
          create: {
            symbol: 'LPT',
            priceUsd: lptLive,
            fetchedAt: now,
            source: WALLET_PRICE_SOURCE_PUBLIC_EXCHANGE,
          },
          update: {
            priceUsd: lptLive,
            fetchedAt: now,
            source: WALLET_PRICE_SOURCE_PUBLIC_EXCHANGE,
          },
        }),
      );
    }
    if (ethLive != null) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol: 'ETH' },
          create: {
            symbol: 'ETH',
            priceUsd: ethLive,
            fetchedAt: now,
            source: WALLET_PRICE_SOURCE_PUBLIC_EXCHANGE,
          },
          update: {
            priceUsd: ethLive,
            fetchedAt: now,
            source: WALLET_PRICE_SOURCE_PUBLIC_EXCHANGE,
          },
        }),
      );
    }
    if (persist.length > 0) await Promise.all(persist);

    const usedLiveQuote = lptLive != null || ethLive != null;
    const fetchedAt = usedLiveQuote
      ? now.toISOString()
      : maxFetchedAtIso(fallbackRows) ?? now.toISOString();

    return success({
      lptUsd,
      ethUsd,
      pricesAvailable: lptUsd != null && ethUsd != null,
      fetchedAt,
    });
  } catch (err) {
    console.error('Error fetching prices:', err);
    return errors.internal('Failed to fetch prices');
  }
}
