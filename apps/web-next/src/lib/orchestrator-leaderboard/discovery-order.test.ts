import { describe, it, expect } from 'vitest';

import {
  effectiveDiscoveryTierCount,
  tierIndexRanges,
  tieredShuffleDiscoveryAddresses,
} from './discovery-order';

describe('effectiveDiscoveryTierCount', () => {
  it('returns 1 for empty or single-item lists', () => {
    expect(effectiveDiscoveryTierCount(0, 5)).toBe(1);
    expect(effectiveDiscoveryTierCount(1, 5)).toBe(1);
  });

  it('targets about the requested number of tiers while keeping tier size at least 2 when possible', () => {
    expect(effectiveDiscoveryTierCount(25, 5)).toBe(5);
    expect(effectiveDiscoveryTierCount(7, 5)).toBe(4);
    expect(effectiveDiscoveryTierCount(3, 5)).toBe(2);
  });
});

describe('tierIndexRanges', () => {
  it('partitions n indices into k contiguous ranges', () => {
    const ranges = tierIndexRanges(11, 4);
    expect(ranges).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 11 },
    ]);
  });
});

describe('tieredShuffleDiscoveryAddresses', () => {
  it('de-duplicates while preserving first-seen order', () => {
    const out = tieredShuffleDiscoveryAddresses(
      [' https://a ', 'https://b', 'https://a', 'https://c'],
      { random: () => 0.999999 },
    );
    expect(out).toEqual(['https://a', 'https://b', 'https://c']);
  });

  it('keeps each tier as a multiset permutation of the original slice', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const n = input.length;
    const k = effectiveDiscoveryTierCount(n, 5);
    const ranges = tierIndexRanges(n, k);

    let call = 0;
    const random = () => {
      const seq = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.55, 0.45];
      return seq[call++ % seq.length] ?? 0.5;
    };

    const out = tieredShuffleDiscoveryAddresses([...input], { random, tierCount: 5 });

    for (const { start, end } of ranges) {
      const before = input.slice(start, end).sort().join(',');
      const after = out.slice(start, end).sort().join(',');
      expect(after).toBe(before);
    }
  });

  it('reorders within tiers when RNG biases low indices', () => {
    const input = ['a', 'b', 'c', 'd'];
    const out = tieredShuffleDiscoveryAddresses([...input], {
      random: () => 0,
      tierCount: 2,
    });
    expect(new Set(out)).toEqual(new Set(input));
    expect(out).not.toEqual(input);
  });
});
