import { after } from 'next/server';

import { staleWhileRevalidate, type SwrResult } from '@naap/cache';

/**
 * Speed-first SWR defaults (override via env):
 *   BFF_SWR_SOFT_SEC  – how long a cached value is fresh (HIT). Higher = more HITs.
 *                       Default 300s (5 min) balances freshness with cache efficiency.
 *   BFF_SWR_HARD_SEC  – max stale age before hard expiry. Default 3600s (1h).
 *   BFF_SWR_LOCK_SEC  – background-refresh distributed lock TTL. Default 30s.
 */
export function readBffSwrEnv(): {
  softTtlSec: number;
  hardTtlSec: number;
  lockTtlSec: number;
} {
  const softTtlSec = Math.max(5, parseInt(process.env.BFF_SWR_SOFT_SEC ?? '300', 10) || 300);
  const hardTtlSec = Math.max(
    softTtlSec + 1,
    parseInt(process.env.BFF_SWR_HARD_SEC ?? '3600', 10) || 3600
  );
  const lockTtlSec = Math.max(10, parseInt(process.env.BFF_SWR_LOCK_SEC ?? '30', 10) || 30);
  return {
    softTtlSec,
    hardTtlSec,
    lockTtlSec,
  };
}

/**
 * BFF stale-while-revalidate: shared Redis/memory envelope + Next.js `after()` for refresh.
 */
export async function bffStaleWhileRevalidate<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  label: string
): Promise<SwrResult<T>> {
  const { softTtlSec, hardTtlSec, lockTtlSec } = readBffSwrEnv();
  return staleWhileRevalidate(fetcher, {
    key: cacheKey,
    softTtlSec,
    hardTtlSec,
    lockTtlSec,
    scheduleBackground: (work: () => Promise<void>) => {
      after(work);
    },
    label,
  });
}
