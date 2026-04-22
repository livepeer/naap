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

    await Promise.all([
      prisma.walletPriceCache.create({ data: { symbol: 'LPT', priceUsd: lptUsd, fetchedAt: now } }),
      prisma.walletPriceCache.create({ data: { symbol: 'ETH', priceUsd: ethUsd, fetchedAt: now } }),
    ]);

    return success({ lptUsd, ethUsd });
  } catch (err) {
    console.error('Cron prices error:', err);
    return errors.internal('Price fetch job failed');
  }
}
