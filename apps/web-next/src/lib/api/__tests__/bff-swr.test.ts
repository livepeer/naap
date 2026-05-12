import { describe, it, expect, vi } from 'vitest';

vi.mock('next/server', () => ({
  after: (work: () => Promise<void>) => {
    void work().catch(() => {
      /* swallow background errors in tests */
    });
  },
}));

import { bffStaleWhileRevalidate } from '../bff-swr';

describe('bffStaleWhileRevalidate — BFF SWR contract (regression guard for #304)', () => {
  it('returns MISS on first call, HIT on second call within softTtl', async () => {
    const key = `test-miss-then-hit-${Date.now()}-${Math.random()}`;
    let calls = 0;
    const fetcher = async (): Promise<{ kpi: number }> => {
      calls++;
      return { kpi: calls };
    };

    const first = await bffStaleWhileRevalidate(key, fetcher, 'test');
    expect(first.cache).toBe('MISS');
    expect(first.data).toEqual({ kpi: 1 });

    const second = await bffStaleWhileRevalidate(key, fetcher, 'test');
    expect(second.cache).toBe('HIT');
    expect(second.data).toEqual({ kpi: 1 });
    expect(calls, 'fetcher must not re-run while envelope is fresh').toBe(1);
  });

  it('coalesces concurrent callers onto a single upstream fetch', async () => {
    const key = `test-coalesce-${Date.now()}-${Math.random()}`;
    let calls = 0;
    const fetcher = async (): Promise<{ kpi: number }> => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return { kpi: calls };
    };

    const [a, b, c] = await Promise.all([
      bffStaleWhileRevalidate(key, fetcher, 'test'),
      bffStaleWhileRevalidate(key, fetcher, 'test'),
      bffStaleWhileRevalidate(key, fetcher, 'test'),
    ]);

    expect(a.data).toEqual(b.data);
    expect(b.data).toEqual(c.data);
    expect(calls, 'concurrent callers must coalesce onto exactly one upstream fetch').toBe(1);
  });

  it('propagates fetcher errors on initial MISS and leaves cache empty', async () => {
    const key = `test-error-${Date.now()}-${Math.random()}`;
    const fetcher = async (): Promise<never> => {
      throw new Error('upstream boom');
    };

    await expect(bffStaleWhileRevalidate(key, fetcher, 'test')).rejects.toThrow('upstream boom');

    // Subsequent call with a different fetcher should still see MISS (no cached error)
    let calls = 0;
    const goodFetcher = async (): Promise<{ ok: true; calls: number }> => {
      calls++;
      return { ok: true, calls };
    };
    const recovery = await bffStaleWhileRevalidate(key, goodFetcher, 'test');
    expect(recovery.cache).toBe('MISS');
    expect(recovery.data).toEqual({ ok: true, calls: 1 });
  });
});
