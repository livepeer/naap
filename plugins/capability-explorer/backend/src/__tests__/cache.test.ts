import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, clearCache, getCacheStats } from '../cache.js';

describe('cache', () => {
  beforeEach(() => clearCache());

  it('returns null for missing keys', () => {
    expect(getCached('nope')).toBeNull();
  });

  it('stores and retrieves values', () => {
    setCached('key1', { value: 42 }, 10_000);
    expect(getCached('key1')).toEqual({ value: 42 });
  });

  it('expires entries after TTL', () => {
    setCached('exp', 'data', 1);
    // Wait a bit for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(getCached('exp')).toBeNull();
  });

  it('tracks hit/miss stats', () => {
    setCached('k', 'v', 10_000);
    getCached('k');
    getCached('miss');
    const stats = getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('evicts oldest when at capacity', () => {
    for (let i = 0; i < 101; i++) {
      setCached(`item-${i}`, i, 60_000);
    }
    expect(getCacheStats().size).toBeLessThanOrEqual(100);
  });
});
