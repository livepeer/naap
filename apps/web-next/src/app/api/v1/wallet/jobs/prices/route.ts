/**
 * Vercel Cron trigger for price fetching
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return errors.unauthorized('Invalid cron secret');
  }

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const apiKey = process.env.COINGECKO_API_KEY;
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const resp = await fetch(`${COINGECKO_BASE}/simple/price?ids=livepeer,ethereum&vs_currencies=usd`, { headers });
    const data = await resp.json();
    const now = new Date();

    await Promise.all([
      prisma.walletPriceCache.create({ data: { symbol: 'LPT', priceUsd: data?.livepeer?.usd ?? 0, fetchedAt: now } }),
      prisma.walletPriceCache.create({ data: { symbol: 'ETH', priceUsd: data?.ethereum?.usd ?? 0, fetchedAt: now } }),
    ]);

    return success({ lptUsd: data?.livepeer?.usd, ethUsd: data?.ethereum?.usd });
  } catch (err) {
    console.error('Cron prices error:', err);
    return errors.internal('Price fetch job failed');
  }
}
