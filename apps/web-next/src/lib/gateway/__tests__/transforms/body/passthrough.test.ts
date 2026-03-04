import { describe, it, expect } from 'vitest';
import { passthroughTransform } from '../../../transforms/body/passthrough';

describe('passthrough body transform', () => {
  it('returns consumer body unchanged', () => {
    const result = passthroughTransform.transform({
      bodyTransform: 'passthrough',
      consumerBody: '{"key":"value"}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('{"key":"value"}');
  });

  it('returns undefined for null body', () => {
    const result = passthroughTransform.transform({
      bodyTransform: 'passthrough',
      consumerBody: null,
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty string body', () => {
    const result = passthroughTransform.transform({
      bodyTransform: 'passthrough',
      consumerBody: '',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });
});
