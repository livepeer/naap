/**
 * Tests for single-flight deduplication, TTL cache, retry logic, and configCacheKey.
 *
 * singleFlight prevents request storms by:
 * 1. Deduplicating concurrent calls with the same key
 * 2. Caching resolved values for a short TTL
 * 3. Retrying on network/server errors with bounded attempts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  singleFlight,
  invalidateCache,
  configCacheKey,
} from '../single-flight.js';

describe('singleFlight', () => {
  describe('single-flight deduplication', () => {
    it('two concurrent calls with the same key share the same promise (only one fn execution)', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 'result' });

      const [result1, result2] = await Promise.all([
        singleFlight('dedup-key', fn, { ttlMs: 0 }),
        singleFlight('dedup-key', fn, { ttlMs: 0 }),
      ]);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ data: 'result' });
      expect(result2).toEqual({ data: 'result' });
    });
  });

  describe('different keys', () => {
    it('two concurrent calls with different keys execute independently', async () => {
      const fn1 = vi.fn().mockResolvedValue('result-1');
      const fn2 = vi.fn().mockResolvedValue('result-2');

      const [result1, result2] = await Promise.all([
        singleFlight('key-a', fn1, { ttlMs: 0 }),
        singleFlight('key-b', fn2, { ttlMs: 0 }),
      ]);

      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
    });
  });

  describe('TTL cache', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('after a successful call, subsequent calls within TTL return cached value without re-executing fn', async () => {
      const fn = vi.fn().mockResolvedValue({ cached: true });
      const ttlMs = 1000;

      // First call executes fn
      const promise1 = singleFlight('ttl-key', fn, { ttlMs });
      await vi.runAllTimersAsync();
      const result1 = await promise1;

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ cached: true });

      // Second call within TTL returns from cache (fn not called again)
      const result2 = await singleFlight('ttl-key', fn, { ttlMs });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result2).toEqual({ cached: true });
    });
  });

  describe('cache expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('after TTL expires, the function is re-executed', async () => {
      const fn = vi.fn().mockResolvedValue({ value: 1 });
      const ttlMs = 1000;

      // First call
      const promise1 = singleFlight('expiry-key', fn, { ttlMs });
      await vi.runAllTimersAsync();
      await promise1;
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance past TTL
      vi.advanceTimersByTime(ttlMs + 1);

      // Second call should re-execute fn
      fn.mockResolvedValueOnce({ value: 2 });
      const result2 = await singleFlight('expiry-key', fn, { ttlMs });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(result2).toEqual({ value: 2 });
    });
  });

  describe('invalidateCache', () => {
    it('removes cached value so next call re-executes fn', async () => {
      const fn = vi.fn().mockResolvedValue('value');
      const key = 'invalidate-key';

      // First call populates cache
      const result1 = await singleFlight(key, fn, { ttlMs: 5000 });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result1).toBe('value');

      // Second call hits cache
      const result2 = await singleFlight(key, fn, { ttlMs: 5000 });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result2).toBe('value');

      // Invalidate
      invalidateCache(key);

      // Third call re-executes fn
      fn.mockResolvedValueOnce('new-value');
      const result3 = await singleFlight(key, fn, { ttlMs: 5000 });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(result3).toBe('new-value');
    });
  });

  describe('bounded retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries up to maxRetries times on TypeError (network error)', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('success');

      const promise = singleFlight('retry-key', fn, {
        ttlMs: 0,
        maxRetries: 2,
        baseDelayMs: 100,
      });

      // Advance timers to flush retry delays
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(fn).toHaveBeenCalledTimes(3);
      expect(result).toBe('success');
    });
  });

  describe('no retry on non-retryable errors', () => {
    it('does not retry when fn throws Error with status 400', async () => {
      const err = new Error('Bad request') as Error & { status?: number };
      err.status = 400;
      const fn = vi.fn().mockRejectedValue(err);

      await expect(
        singleFlight('no-retry-key', fn, { ttlMs: 0, maxRetries: 2 }),
      ).rejects.toThrow('Bad request');

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('configCacheKey', () => {
  it('produces stable keys in format config:{pluginName}:{scope}:{teamId}', () => {
    expect(configCacheKey('marketplace', 'personal', 'team-123')).toBe(
      'config:marketplace:personal:team-123',
    );
    expect(configCacheKey('community', 'workspace', '')).toBe(
      'config:community:workspace:',
    );
    expect(configCacheKey('marketplace', 'personal', null)).toBe(
      'config:marketplace:personal:',
    );
    expect(configCacheKey('marketplace', 'personal', undefined)).toBe(
      'config:marketplace:personal:',
    );
  });
});
