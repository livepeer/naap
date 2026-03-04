import { describe, it, expect } from 'vitest';
import { extractTransform } from '../../../transforms/body/extract';

describe('extract body transform', () => {
  it('extracts nested field from JSON body', () => {
    const result = extractTransform.transform({
      bodyTransform: 'extract:data.query',
      consumerBody: '{"data":{"query":"SELECT 1"},"meta":{}}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('"SELECT 1"');
  });

  it('returns consumer body when path not found', () => {
    const result = extractTransform.transform({
      bodyTransform: 'extract:missing.path',
      consumerBody: '{"data":"hello"}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('{"data":"hello"}');
  });

  it('falls back on malformed JSON', () => {
    const result = extractTransform.transform({
      bodyTransform: 'extract:data',
      consumerBody: 'not-json',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('not-json');
  });

  it('returns undefined for null body', () => {
    const result = extractTransform.transform({
      bodyTransform: 'extract:data',
      consumerBody: null,
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBeUndefined();
  });
});
