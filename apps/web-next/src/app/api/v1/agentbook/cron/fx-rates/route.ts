/**
 * FX-rate refresh cron (PR 13). Pulls today's USD↔EUR/GBP/CAD/JPY pairs
 * from frankfurter.app (free, no key, ECB-sourced) and upserts each into
 * `AbFxRate` so reads through `getRate()` hit the cache for the day.
 *
 * The actual fetching lives in `getRate()` so behaviour stays uniform
 * with on-demand reads (and so a single failure mode is exercised
 * everywhere). The cron just primes the cache.
 *
 * Vercel cron: "0 6 * * *" (06:00 UTC). Idempotent — same-day reruns
 * upsert the same row. Bearer-gated when `CRON_SECRET` is set.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRate } from '@/lib/agentbook-fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Pairs we proactively refresh — the four currencies in active use today. */
const PAIRS: Array<[string, string]> = [
  ['USD', 'EUR'],
  ['EUR', 'USD'],
  ['USD', 'GBP'],
  ['GBP', 'USD'],
  ['USD', 'CAD'],
  ['CAD', 'USD'],
  ['USD', 'JPY'],
  ['JPY', 'USD'],
];

function safeCompareBearer(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    !safeCompareBearer(authHeader, process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let updated = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const [from, to] of PAIRS) {
    try {
      const rate = await getRate(from, to);
      if (rate) updated++;
      else {
        failed++;
        failures.push(`${from}->${to}`);
      }
    } catch (err) {
      // getRate doesn't throw, but defence-in-depth — never let one pair
      // sink the cron.
      failed++;
      failures.push(`${from}->${to}`);
      console.warn('[cron/fx-rates] getRate threw unexpectedly:', err);
    }
  }

  return NextResponse.json({
    success: failed === 0,
    data: {
      pairs: PAIRS.length,
      updated,
      failed,
      ...(failures.length ? { failures } : {}),
    },
  });
}
