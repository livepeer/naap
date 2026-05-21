/**
 * Tests for src/lib/auth/resend-cooldown.ts — Redis-backed resend cooldown.
 *
 * Memory-fallback paths run when Redis is unavailable; Redis paths exercised
 * via a mocked getRedis() so we don't require a running server.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  tryAcquireCooldown,
  __clearCooldownMemoryForTests,
} from '@/lib/auth/resend-cooldown';

const mockRedisSet = vi.fn();
const mockGetRedis = vi.fn();
const mockIsRedisConnected = vi.fn();

vi.mock('@naap/cache', () => ({
  getRedis: () => mockGetRedis(),
  isRedisConnected: () => mockIsRedisConnected(),
  // Kept for any other callers; not used by the cooldown helper anymore.
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
}));

describe('tryAcquireCooldown', () => {
  beforeEach(() => {
    __clearCooldownMemoryForTests();
    mockRedisSet.mockReset();
    mockGetRedis.mockReset();
    mockIsRedisConnected.mockReset();
  });

  describe('memory fallback (no Redis)', () => {
    beforeEach(() => {
      mockGetRedis.mockReturnValue(null);
      mockIsRedisConnected.mockReturnValue(false);
    });

    it('acquires on first call, rejects within TTL', async () => {
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
  });

  describe('redis path (atomic SET NX PX)', () => {
    beforeEach(() => {
      mockGetRedis.mockReturnValue({ set: mockRedisSet });
      mockIsRedisConnected.mockReturnValue(true);
    });

    it('returns true when Redis SET NX returns OK (key acquired)', async () => {
      mockRedisSet.mockResolvedValue('OK');
      const acquired = await tryAcquireCooldown('fresh@example.com', {
        purpose: 'verification',
        ttlMs: 60_000,
      });
      expect(acquired).toBe(true);
      expect(mockRedisSet).toHaveBeenCalledOnce();
      const [key, value, mode1, ttl, mode2] = mockRedisSet.mock.calls[0];
      expect(key).toMatch(/^auth:resend-cooldown:verification:[a-f0-9]{64}$/);
      expect(typeof value).toBe('string');
      expect(mode1).toBe('PX');
      expect(ttl).toBe(60_000);
      expect(mode2).toBe('NX');
    });

    it('returns false when Redis SET NX returns null (key already held)', async () => {
      mockRedisSet.mockResolvedValue(null);
      const acquired = await tryAcquireCooldown('held@example.com', {
        purpose: 'verification',
        ttlMs: 60_000,
      });
      expect(acquired).toBe(false);
    });

    it('falls back to memory when Redis throws', async () => {
      mockRedisSet.mockRejectedValue(new Error('redis exploded'));
      const first = await tryAcquireCooldown('falls-back@example.com', {
        purpose: 'verification',
        ttlMs: 60_000,
      });
      const second = await tryAcquireCooldown('falls-back@example.com', {
        purpose: 'verification',
        ttlMs: 60_000,
      });
      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });
});
