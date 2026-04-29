/**
 * Vercel Cron trigger for price fetching
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

function validPositiveUsd(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return errors.internal('Cron secret not configured');
  if (secret !== cronSecret) return errors.unauthorized('Invalid cron secret');

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const apiKey = process.env.COINGECKO_API_KEY;
    if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

    const resp = await fetch(`${COINGECKO_BASE}/simple/price?ids=livepeer,ethereum&vs_currencies=usd`, { headers });
    const data = await resp.json();
    const now = new Date();

    const lptRaw = data?.livepeer?.usd;
    const ethRaw = data?.ethereum?.usd;
    const creates: Promise<unknown>[] = [];
    if (validPositiveUsd(lptRaw)) {
      creates.push(
        prisma.walletPriceCache.create({ data: { symbol: 'LPT', priceUsd: lptRaw, fetchedAt: now } }),
      );
    }
    if (validPositiveUsd(ethRaw)) {
      creates.push(
        prisma.walletPriceCache.create({ data: { symbol: 'ETH', priceUsd: ethRaw, fetchedAt: now } }),
      );
    }
    if (creates.length > 0) await Promise.all(creates);

    return success({
      lptUsd: validPositiveUsd(lptRaw) ? lptRaw : 0,
      ethUsd: validPositiveUsd(ethRaw) ? ethRaw : 0,
    });
  } catch (err) {
    console.error('Cron prices error:', err);
    return errors.internal('Price fetch job failed');
  }
}
