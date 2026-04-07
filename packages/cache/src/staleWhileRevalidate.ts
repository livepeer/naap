/**
 * Stale-while-revalidate for BFF / serverless handlers.
 *
 * Serves the last successful payload from Redis (or in-memory fallback) immediately.
 * When the entry is past {@link StaleWhileRevalidateOptions.softTtlSec}, returns stale
 * data and schedules a single refresh (per key) via {@link scheduleBackground}.
 */

import { createHash } from 'node:crypto';

import { cacheGet, cacheSet } from './cache.js';
import { getRedis, isRedisConnected } from './redis.js';

export interface SwrEnvelope<T = unknown> {
  body: T;
  fetchedAt: number;
}

export interface StaleWhileRevalidateOptions {
  /** Logical cache key (hashed for storage); e.g. `perf-by-model:start:end` */
  key: string;
  softTtlSec: number;
  hardTtlSec: number;
  /** Lock TTL; should exceed worst-case upstream latency */
  lockTtlSec?: number;
  /** Redis/memory prefix for the envelope */
  dataPrefix?: string;
  /** Prefix for distributed lock keys */
  lockPrefix?: string;
  /**
   * Schedule work after the HTTP response (e.g. `next/server` `after`).
   * Without this, background refresh may not complete on Vercel after the handler returns.
   */
  scheduleBackground?: (work: () => Promise<void>) => void;
  /** Log label */
  label?: string;
}

export type SwrCacheStatus = 'HIT' | 'STALE' | 'MISS';

export interface SwrResult<T> {
  data: T;
  cache: SwrCacheStatus;
}

const memLocks = new Map<string, number>();

function storageIdFromKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryMemLock(lockKey: string, ttlSec: number): boolean {
  const now = Date.now();
  const exp = memLocks.get(lockKey);
  if (exp !== undefined && exp > now) {
    return false;
  }
  memLocks.set(lockKey, now + ttlSec * 1000);
  return true;
}

function releaseMemLock(lockKey: string): void {
  memLocks.delete(lockKey);
}

async function tryAcquireLock(lockRedisKey: string, ttlSec: number): Promise<boolean> {
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      const r = await redis.set(lockRedisKey, '1', 'EX', ttlSec, 'NX');
      return r === 'OK';
    } catch (err) {
      console.warn('[SWR] Redis lock acquire failed, using memory:', err);
    }
  }
  return tryMemLock(lockRedisKey, ttlSec);
}

async function releaseLock(lockRedisKey: string): Promise<void> {
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      await redis.del(lockRedisKey);
      return;
    } catch (err) {
      console.warn('[SWR] Redis lock release failed:', err);
    }
  }
  releaseMemLock(lockRedisKey);
}

function defaultSchedule(work: () => Promise<void>): void {
  void work().catch((err) => console.warn('[SWR] background work failed:', err));
}

function log(label: string | undefined, msg: string): void {
  const p = label ? `[SWR:${label}]` : '[SWR]';
  console.log(`${p} ${msg}`);
}

/**
 * Read-through cache with stale-while-revalidate semantics.
 */
export async function staleWhileRevalidate<T>(
  fetcher: () => Promise<T>,
  options: StaleWhileRevalidateOptions
): Promise<SwrResult<T>> {
  const {
    key,
    softTtlSec,
    hardTtlSec,
    lockTtlSec = 90,
    dataPrefix = 'bff-swr',
    lockPrefix = 'bff-swr-lock',
    scheduleBackground,
    label,
  } = options;

  const id = storageIdFromKey(key);
  const lockKey = `${lockPrefix}:${id}`;
  const schedule = scheduleBackground ?? ((work: () => Promise<void>) => defaultSchedule(work));

  const envelope = await cacheGet<SwrEnvelope<T>>(id, { prefix: dataPrefix });
  const now = Date.now();

  if (envelope && Number.isFinite(envelope.fetchedAt)) {
    const ageSec = (now - envelope.fetchedAt) / 1000;
    if (ageSec < softTtlSec) {
      log(label, `HIT fresh (age ${ageSec.toFixed(1)}s < ${softTtlSec}s)`);
      return { data: envelope.body, cache: 'HIT' };
    }

    const acquired = await tryAcquireLock(lockKey, lockTtlSec);
    if (acquired) {
      log(label, `STALE (age ${ageSec.toFixed(1)}s) — scheduling refresh`);
      schedule(async () => {
        try {
          const fresh = await fetcher();
          const next: SwrEnvelope<T> = { body: fresh, fetchedAt: Date.now() };
          await cacheSet(id, next, { prefix: dataPrefix, ttl: hardTtlSec });
          log(label, 'background refresh OK');
        } catch (err) {
          console.warn(`[SWR${label ? `:${label}` : ''}] background refresh failed (keeping stale):`, err);
        } finally {
          await releaseLock(lockKey);
        }
      });
      return { data: envelope.body, cache: 'STALE' };
    }

    log(label, `STALE (age ${ageSec.toFixed(1)}s) — refresh in progress elsewhere`);
    return { data: envelope.body, cache: 'STALE' };
  }

  const acquired = await tryAcquireLock(lockKey, lockTtlSec);
  if (acquired) {
    try {
      log(label, 'MISS — fetching (blocking)');
      const body = await fetcher();
      const next: SwrEnvelope<T> = { body, fetchedAt: Date.now() };
      await cacheSet(id, next, { prefix: dataPrefix, ttl: hardTtlSec });
      return { data: body, cache: 'MISS' };
    } finally {
      await releaseLock(lockKey);
    }
  }

  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const waited = await cacheGet<SwrEnvelope<T>>(id, { prefix: dataPrefix });
    if (waited && Number.isFinite(waited.fetchedAt)) {
      const ageSec = (Date.now() - waited.fetchedAt) / 1000;
      log(label, `HIT after wait (attempt ${i + 1}, age ${ageSec.toFixed(1)}s)`);
      const cache: SwrCacheStatus = ageSec < softTtlSec ? 'HIT' : 'STALE';
      return { data: waited.body, cache };
    }
  }

  log(label, 'MISS — lock contention timeout, fetching inline');
  const body = await fetcher();
  const next: SwrEnvelope<T> = { body, fetchedAt: Date.now() };
  await cacheSet(id, next, { prefix: dataPrefix, ttl: hardTtlSec });
  return { data: body, cache: 'MISS' };
}
