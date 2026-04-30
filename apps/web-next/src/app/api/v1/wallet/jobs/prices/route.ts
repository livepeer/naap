/**
 * Vercel Cron trigger for price fetching
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import {
  fetchEthUsdFromPublicExchangesWithSource,
  fetchLptUsdFromPublicExchangesWithSource,
} from '@/lib/prices/public-exchange-spot';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return errors.internal('Cron secret not configured');
  if (secret !== cronSecret) return errors.unauthorized('Invalid cron secret');

  try {
    const [lptMeta, ethMeta] = await Promise.all([
      fetchLptUsdFromPublicExchangesWithSource(),
      fetchEthUsdFromPublicExchangesWithSource(),
    ]);
    const lptUsdRaw = lptMeta.price;
    const ethUsdRaw = ethMeta.price;
    const lptUsd =
      lptUsdRaw != null && Number.isFinite(lptUsdRaw) && lptUsdRaw > 0 ? lptUsdRaw : null;
    const ethUsd =
      ethUsdRaw != null && Number.isFinite(ethUsdRaw) && ethUsdRaw > 0 ? ethUsdRaw : null;

    const lptOk = lptUsd != null;
    const ethOk = ethUsd != null;
    if (!lptOk && !ethOk) {
      throw new Error(
        `Public exchange price fetch miss (both LPT and ETH): lptUsdRaw=${String(lptUsdRaw)} ethUsdRaw=${String(ethUsdRaw)}`,
      );
    }

    const now = new Date();

    const persist: Promise<unknown>[] = [];
    if (lptUsd != null && lptMeta.source) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol: 'LPT' },
          create: {
            symbol: 'LPT',
            priceUsd: lptUsd,
            fetchedAt: now,
            source: lptMeta.source,
          },
          update: {
            priceUsd: lptUsd,
            fetchedAt: now,
            source: lptMeta.source,
          },
        }),
      );
    }
    if (ethUsd != null && ethMeta.source) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol: 'ETH' },
          create: {
            symbol: 'ETH',
            priceUsd: ethUsd,
            fetchedAt: now,
            source: ethMeta.source,
          },
          update: {
            priceUsd: ethUsd,
            fetchedAt: now,
            source: ethMeta.source,
          },
        }),
      );
    }
    if (persist.length > 0) await Promise.all(persist);

    return success({
      lptUsd,
      ethUsd,
    });
  } catch (err) {
    console.error('Cron prices error:', err);
    return errors.internal('Price fetch job failed');
  }
}
