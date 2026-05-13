import { test, expect } from '@playwright/test';

/**
 * Regression guard for issue #304 — BFF SWR cache must persist across
 * serverless instances via Redis.
 *
 * Strategy
 * --------
 * The Vercel CDN keys responses by full URL; the BFF cache (apps/web-next/src/lib/
 * api/bff-swr.ts → @naap/cache staleWhileRevalidate) keys by the route's logical
 * cacheKey, e.g. `kpi:${hours}:${pipeline ?? 'all'}:${model_id ?? 'all'}` from
 * apps/web-next/src/app/api/v1/dashboard/kpi/route.ts.
 *
 * Adding `?cb=<unique>` to each request defeats the CDN (different URL) but
 * reuses the BFF cache key (cb is not in the key). With REDIS_URL set: every
 * function invocation — possibly on different serverless instances — reads the
 * same envelope and returns `X-Cache: HIT|STALE`. Without Redis (the #304 bug):
 * each new instance returns `X-Cache: MISS`.
 *
 * Tagged @pre-release so the nightly e2e-ga workflow
 * (.github/workflows/e2e-nightly.yml) picks it up against production.
 */
test.describe('BFF Redis cache (issue #304) @pre-release', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('dashboard KPI BFF returns X-Cache: HIT across CDN-busted requests', async ({
    request,
    baseURL,
  }) => {
    test.skip(!baseURL, 'baseURL required');
    test.skip(
      baseURL!.includes('localhost'),
      'requires a deployed Vercel env with REDIS_URL set (local dev defaults to in-memory)',
    );

    // Warm the BFF — first invocation populates the SWR envelope in Redis.
    const warmRes = await request.get(
      `/api/v1/dashboard/kpi?timeframe=24&cb=warm-${Date.now()}`,
    );
    expect(warmRes.status(), 'KPI endpoint must respond 200 on warm').toBe(200);

    // Small settle to let the SWR write land in Redis before the next read.
    await new Promise((r) => setTimeout(r, 1500));

    const samples: Array<{
      xCache: string | undefined;
      xVercelCache: string | undefined;
    }> = [];

    for (let i = 0; i < 5; i++) {
      const res = await request.get(
        `/api/v1/dashboard/kpi?timeframe=24&cb=${Date.now()}-${i}`,
      );
      expect(res.status(), `KPI endpoint must respond 200 (sample ${i})`).toBe(200);
      samples.push({
        xCache: res.headers()['x-cache'],
        xVercelCache: res.headers()['x-vercel-cache'],
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log('\n=== BFF cache samples (issue #304 guardrail) ===');
    for (const s of samples) {
      console.log(
        `  X-Cache=${s.xCache ?? '(none)'}  x-vercel-cache=${s.xVercelCache ?? '(none)'}`,
      );
    }
    console.log('');

    // Regression guard A: the route must always emit X-Cache (proves SWR is wired).
    for (const [i, s] of samples.entries()) {
      expect(
        s.xCache,
        `X-Cache header missing on sample ${i}: route is bypassing bffStaleWhileRevalidate`,
      ).toBeTruthy();
    }

    // Regression guard B: with Redis, ≥4/5 cache-busted calls should HIT or STALE.
    // A MISS rate > 1/5 means the envelope is per-instance (the #304 bug).
    const hitOrStale = samples.filter(
      (s) => s.xCache === 'HIT' || s.xCache === 'STALE',
    ).length;
    expect(
      hitOrStale,
      `Expected >=4/5 X-Cache HIT|STALE across CDN-busted requests, got ${hitOrStale}/5. ` +
        `Indicates REDIS_URL is not set or the BFF SWR envelope is per-instance (#304).`,
    ).toBeGreaterThanOrEqual(4);
  });
});
