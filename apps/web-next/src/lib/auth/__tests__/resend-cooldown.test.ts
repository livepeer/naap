/**
 * Tests for src/lib/auth/resend-cooldown.ts — Redis-backed resend cooldown.
 *
 * Tests cover the in-memory fallback path (no REDIS_URL); Redis-backed
 * behavior is covered by integration tests in apps/web-next/tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  tryAcquireCooldown,
  __clearCooldownMemoryForTests,
} from '@/lib/auth/resend-cooldown';

vi.mock('@naap/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
}));

describe('tryAcquireCooldown (memory fallback)', () => {
  beforeEach(async () => {
    __clearCooldownMemoryForTests();
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockReset();
    (cache.cacheSet as ReturnType<typeof vi.fn>).mockReset();
  });

  it('acquires on first call, rejects within TTL', async () => {
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no redis'));

    const first = await tryAcquireCooldown('user@example.com', {
      purpose: 'verification',
      ttlMs: 60_000,
    });
    expect(first).toBe(true);

    const second = await tryAcquireCooldown('user@example.com', {
      purpose: 'verification',
      ttlMs: 60_000,
    });
    expect(second).toBe(false);
  });

  it('is case- and whitespace-insensitive for email', async () => {
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no redis'));

    expect(
      await tryAcquireCooldown('User@Example.com', {
        purpose: 'verification',
        ttlMs: 60_000,
      })
    ).toBe(true);
    expect(
      await tryAcquireCooldown(' user@example.com ', {
        purpose: 'verification',
        ttlMs: 60_000,
      })
    ).toBe(false);
  });

  it('separates cooldowns by purpose', async () => {
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no redis'));

    expect(
      await tryAcquireCooldown('a@b.com', { purpose: 'verification', ttlMs: 60_000 })
    ).toBe(true);
    expect(
      await tryAcquireCooldown('a@b.com', { purpose: 'password-reset', ttlMs: 60_000 })
    ).toBe(true);
  });

  it('returns false for empty email', async () => {
    expect(
      await tryAcquireCooldown('', { purpose: 'verification' })
    ).toBe(false);
  });

  it('uses Redis path when cache returns a recent timestamp', async () => {
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(Date.now());

    const acquired = await tryAcquireCooldown('redis-user@example.com', {
      purpose: 'verification',
      ttlMs: 60_000,
    });
    expect(acquired).toBe(false);
    expect(cache.cacheSet).not.toHaveBeenCalled();
  });

  it('writes via Redis when cache reports no prior cooldown', async () => {
    const cache = await import('@naap/cache');
    (cache.cacheGet as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cache.cacheSet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const acquired = await tryAcquireCooldown('fresh-user@example.com', {
      purpose: 'verification',
      ttlMs: 60_000,
    });
    expect(acquired).toBe(true);
    expect(cache.cacheSet).toHaveBeenCalledOnce();
    const callArgs = (cache.cacheSet as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[2]).toMatchObject({ prefix: 'auth:resend-cooldown', ttl: 60 });
  });
});
