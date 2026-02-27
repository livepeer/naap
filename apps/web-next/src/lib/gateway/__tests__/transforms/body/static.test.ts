import { describe, it, expect } from 'vitest';
import { staticTransform } from '../../../transforms/body/static';

describe('static body transform', () => {
  it('returns static body regardless of consumer input', () => {
    const result = staticTransform.transform({
      bodyTransform: 'static',
      consumerBody: '{"ignored":"data"}',
      consumerBodyRaw: null,
      upstreamStaticBody: '{"fixed":"payload"}',
    });
    expect(result).toBe('{"fixed":"payload"}');
  });

  it('returns undefined when no static body configured', () => {
    const result = staticTransform.transform({
      bodyTransform: 'static',
      consumerBody: null,
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });
});
