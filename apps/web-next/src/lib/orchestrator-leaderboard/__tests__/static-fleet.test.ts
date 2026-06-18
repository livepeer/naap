import { describe, it, expect } from 'vitest';

import { mergeStaticFleet, staticFleetGaps } from '../static-fleet';

describe('mergeStaticFleet', () => {
  it('keeps discovered order first, appends only missing static fallbacks', () => {
    const merged = mergeStaticFleet(
      ['https://a:8935', 'https://b:8935'],
      ['https://b:8935', 'https://c:8935'],
    );
    expect(merged).toEqual(['https://a:8935', 'https://b:8935', 'https://c:8935']);
  });

  it('de-duplicates and trims (first occurrence wins)', () => {
    const merged = mergeStaticFleet([' https://a:8935 ', 'https://a:8935'], ['https://a:8935', '']);
    expect(merged).toEqual(['https://a:8935']);
  });

  it('returns the full static fleet when nothing was discovered (fallback)', () => {
    const merged = mergeStaticFleet([], ['https://x:8935', 'https://y:8935']);
    expect(merged).toEqual(['https://x:8935', 'https://y:8935']);
  });
});

describe('staticFleetGaps', () => {
  it('reports static fallbacks missing from the discovered set', () => {
    expect(
      staticFleetGaps(['https://a:8935'], ['https://a:8935', 'https://b:8935', 'https://b:8935']),
    ).toEqual(['https://b:8935']);
  });

  it('reports no gaps when the discovered set already covers the fleet', () => {
    expect(staticFleetGaps(['https://a:8935', 'https://b:8935'], ['https://a:8935'])).toEqual([]);
  });
});
