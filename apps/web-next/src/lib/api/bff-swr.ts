import { after } from 'next/server';

import { staleWhileRevalidate, type SwrResult } from '@naap/cache';

export function readBffSwrEnv(): {
  softTtlSec: number;
  hardTtlSec: number;
  lockTtlSec: number;
} {
  const softTtlSec = Math.max(5, parseInt(process.env.BFF_SWR_SOFT_SEC ?? '120', 10) || 120);
  const hardTtlSec = Math.max(
    softTtlSec + 1,
    parseInt(process.env.BFF_SWR_HARD_SEC ?? '86400', 10) || 86400
  );
  const lockTtlSec = Math.max(30, parseInt(process.env.BFF_SWR_LOCK_SEC ?? '90', 10) || 90);
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
    scheduleBackground: (work) => {
      after(work);
    },
    label,
  });
}
