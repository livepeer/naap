import { describe, it, expect } from 'vitest';
import { jobFeedCacheMaxAgeSec } from '../overview-http-cache';

describe('jobFeedCacheMaxAgeSec', () => {
  it('maps poll interval ms to seconds capped at 90 with minimum 1', () => {
    expect(jobFeedCacheMaxAgeSec(5_000)).toBe(5);
    expect(jobFeedCacheMaxAgeSec(15_000)).toBe(15);
    expect(jobFeedCacheMaxAgeSec(90_000)).toBe(90);
    expect(jobFeedCacheMaxAgeSec(120_000)).toBe(90);
    expect(jobFeedCacheMaxAgeSec(1_500)).toBe(2);
    expect(jobFeedCacheMaxAgeSec(999)).toBe(30);
  });

  it('defaults to 30 when pollMs is missing or invalid', () => {
    expect(jobFeedCacheMaxAgeSec(null)).toBe(30);
    expect(jobFeedCacheMaxAgeSec(undefined)).toBe(30);
    expect(jobFeedCacheMaxAgeSec(NaN)).toBe(30);
  });
});
