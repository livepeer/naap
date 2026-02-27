import { describe, it, expect } from 'vitest';
import { templateTransform } from '../../../transforms/body/template';

describe('template body transform', () => {
  it('interpolates {{body.field}} placeholders', () => {
    const result = templateTransform.transform({
      bodyTransform: 'template',
      consumerBody: '{"prompt":"neon anime","model":"sdxl"}',
      consumerBodyRaw: null,
      upstreamStaticBody: '{"pipeline":"sd","params":{"prompt":"{{body.prompt}}","model_id":"{{body.model}}"}}',
    });
    expect(JSON.parse(result as string)).toEqual({
      pipeline: 'sd',
      params: { prompt: 'neon anime', model_id: 'sdxl' },
    });
  });

  it('replaces missing fields with empty string', () => {
    const result = templateTransform.transform({
      bodyTransform: 'template',
      consumerBody: '{"prompt":"test"}',
      consumerBodyRaw: null,
      upstreamStaticBody: '{"a":"{{body.prompt}}","b":"{{body.missing}}"}',
    });
    expect(JSON.parse(result as string)).toEqual({ a: 'test', b: '' });
  });

  it('falls back to consumer body when template is null', () => {
    const result = templateTransform.transform({
      bodyTransform: 'template',
      consumerBody: '{"raw":"data"}',
      consumerBodyRaw: null,
      upstreamStaticBody: null,
    });
    expect(result).toBe('{"raw":"data"}');
  });

  it('falls back to consumer body on malformed JSON', () => {
    const result = templateTransform.transform({
      bodyTransform: 'template',
      consumerBody: 'not-json',
      consumerBodyRaw: null,
      upstreamStaticBody: '{"a":"{{body.x}}"}',
    });
    expect(result).toBe('not-json');
  });
});
