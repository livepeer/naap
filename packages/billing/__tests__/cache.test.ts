import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PlanCache, type CachedPlan } from '../src/cache.js';

const sample: CachedPlan = {
  planId: 'p1',
  code: 'pro',
  status: 'active',
  features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
  quotas: { expenses_created: 1000, ocr_scans: 200, ai_messages: 5000, invoices_sent: 200, bank_connections: 3 },
  currentPeriodStart: new Date('2026-05-01'),
  currentPeriodEnd: new Date('2026-06-01'),
  cancelAtPeriodEnd: false,
  cachedAt: Date.now(),
};

describe('PlanCache', () => {
  let cache: PlanCache;
  beforeEach(() => {
    cache = new PlanCache(60_000); // 1 min TTL for tests
  });

  it('returns null on miss', () => {
    expect(cache.get('account-1')).toBeNull();
  });

  it('returns the stored entry on hit', () => {
    cache.set('account-1', sample);
    expect(cache.get('account-1')).toEqual(sample);
  });

  it('returns null after TTL expiry', () => {
    vi.useFakeTimers();
    const fresh: CachedPlan = { ...sample, cachedAt: Date.now() };
    cache.set('account-1', fresh);
    vi.advanceTimersByTime(60_001);
    expect(cache.get('account-1')).toBeNull();
    vi.useRealTimers();
  });

  it('invalidate() removes the entry', () => {
    cache.set('account-1', sample);
    cache.invalidate('account-1');
    expect(cache.get('account-1')).toBeNull();
  });

  it('clear() empties the cache', () => {
    cache.set('a', sample);
    cache.set('b', sample);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });
});
