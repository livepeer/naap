import { describe, it, expect } from 'vitest';
import { binaryTransform } from '../../../transforms/body/binary';

describe('binary body transform', () => {
  it('returns raw ArrayBuffer unchanged', () => {
    const buf = new ArrayBuffer(8);
    const result = binaryTransform.transform({
      bodyTransform: 'binary',
      consumerBody: null,
      consumerBodyRaw: buf,
      upstreamStaticBody: null,
    });
    expect(result).toBe(buf);
  });

  it('returns undefined for null raw body', () => {
    const result = binaryTransform.transform({
      bodyTransform: 'binary',
      consumerBody: null,
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });
});
