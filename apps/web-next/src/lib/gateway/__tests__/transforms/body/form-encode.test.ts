import { describe, it, expect } from 'vitest';
import { formEncodeTransform } from '../../../transforms/body/form-encode';

describe('form-encode body transform', () => {
  it('converts flat JSON to form-encoded string', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: '{"name":"John","email":"john@example.com"}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toContain('name=John');
    expect(result).toContain('email=john%40example.com');
  });

  it('encodes nested objects with bracket notation', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: '{"card":{"number":"4242","exp_month":12}}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    const str = result as string;
    expect(str).toContain('card%5Bnumber%5D=4242');
    expect(str).toContain('card%5Bexp_month%5D=12');
  });

  it('encodes arrays with indexed bracket notation', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: '{"items":["a","b"]}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    const str = result as string;
    expect(str).toContain('items%5B0%5D=a');
    expect(str).toContain('items%5B1%5D=b');
  });

  it('skips null/undefined values', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: '{"a":"1","b":null}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    const str = result as string;
    expect(str).toBe('a=1');
  });

  it('returns undefined for null body', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: null,
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });

  it('returns consumer body on malformed JSON', () => {
    const result = formEncodeTransform.transform({
      bodyTransform: 'form-encode',
      consumerBody: 'not-json',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('not-json');
  });
});
