import { describe, it, expect } from 'vitest';
import { overviewCacheControl } from '../overview-http-cache';

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
