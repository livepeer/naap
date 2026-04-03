import { describe, it, expect } from 'vitest';
import {
  overviewCacheControl,
  jobFeedCacheMaxAgeSec,
  jobFeedSuccessCacheControl,
  jobFeedErrorCacheControl,
} from '../overview-http-cache';

describe('overviewCacheControl', () => {
  it('includes matching max-age, s-maxage, and bounded stale-while-revalidate', () => {
    expect(overviewCacheControl(60)).toBe(
      'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
    );
    expect(overviewCacheControl(1800)).toBe(
      'public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600',
    );
  });

  it('caps stale-while-revalidate at max-age + 3600 when 2× max-age is larger', () => {
    expect(overviewCacheControl(4000)).toBe(
      'public, max-age=4000, s-maxage=4000, stale-while-revalidate=7600',
    );
  });
});

describe('job feed cache helpers', () => {
  it('maps poll interval ms to seconds capped at 90 with default 30 for <1000ms', () => {
    expect(jobFeedCacheMaxAgeSec(undefined)).toBe(30);
    expect(jobFeedCacheMaxAgeSec(999)).toBe(30);
    expect(jobFeedCacheMaxAgeSec(5_000)).toBe(5);
    expect(jobFeedCacheMaxAgeSec(90_000)).toBe(90);
    expect(jobFeedCacheMaxAgeSec(120_000)).toBe(90);
  });

  it('builds success Cache-Control from poll seconds', () => {
    expect(jobFeedSuccessCacheControl(30)).toBe(
      'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
    );
  });

  it('uses a short shared-cache edge TTL on error control', () => {
    expect(jobFeedErrorCacheControl(30)).toBe(
      'public, max-age=0, s-maxage=5, stale-while-revalidate=0',
    );
    expect(jobFeedErrorCacheControl(10)).toBe(
      'public, max-age=0, s-maxage=5, stale-while-revalidate=0',
    );
    expect(jobFeedErrorCacheControl(4)).toBe(
      'public, max-age=0, s-maxage=2, stale-while-revalidate=0',
    );
  });
});
