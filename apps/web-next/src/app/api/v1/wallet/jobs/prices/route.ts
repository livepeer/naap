/**
 * Vercel Cron trigger for price fetching
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import {
  fetchEthUsdFromPublicExchanges,
  fetchLptUsdFromPublicExchanges,
} from '@/lib/prices/public-exchange-spot';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return errors.internal('Cron secret not configured');
  if (secret !== cronSecret) return errors.unauthorized('Invalid cron secret');

  try {
    const [lptUsdRaw, ethUsdRaw] = await Promise.all([
      fetchLptUsdFromPublicExchanges(),
      fetchEthUsdFromPublicExchanges(),
    ]);
    const lptUsd = lptUsdRaw != null && Number.isFinite(lptUsdRaw) && lptUsdRaw > 0 ? lptUsdRaw : 0;
    const ethUsd = ethUsdRaw != null && Number.isFinite(ethUsdRaw) && ethUsdRaw > 0 ? ethUsdRaw : 0;
    const now = new Date();

    const persist: Promise<unknown>[] = [];
    if (lptUsd > 0) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol_fetchedAt: { symbol: 'LPT', fetchedAt: now } },
          create: { symbol: 'LPT', priceUsd: lptUsd, fetchedAt: now },
          update: { priceUsd: lptUsd },
        }),
      );
    }
    if (ethUsd > 0) {
      persist.push(
        prisma.walletPriceCache.upsert({
          where: { symbol_fetchedAt: { symbol: 'ETH', fetchedAt: now } },
          create: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now },
          update: { priceUsd: ethUsd },
        }),
      );
    }
    if (persist.length > 0) await Promise.all(persist);

    return success({ lptUsd, ethUsd });
  } catch (err) {
    console.error('Cron prices error:', err);
    return errors.internal('Price fetch job failed');
  }
}
