/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  CAPABILITY_CATEGORIES,
  CAPABILITY_WILDCARD,
  categoryOfCapability,
  isWellFormedCapabilityId,
  normalizeCapabilities,
  normalizeProviderCapabilities,
  parseCapabilityId,
} from './taxonomy';

describe('NAAP-E taxonomy — parseCapabilityId', () => {
  it('parses the wildcard', () => {
    expect(parseCapabilityId(CAPABILITY_WILDCARD)).toEqual({ kind: 'wildcard', raw: '*' });
  });

  it('parses a tool capability', () => {
    expect(parseCapabilityId('tool:ffmpeg-concat')).toEqual({
      kind: 'tool',
      raw: 'tool:ffmpeg-concat',
      tool: 'ffmpeg-concat',
    });
  });

  it('parses a pipeline/model capability', () => {
    expect(parseCapabilityId('text-to-image:flux-dev')).toEqual({
      kind: 'pipeline-model',
      raw: 'text-to-image:flux-dev',
      pipeline: 'text-to-image',
      model: 'flux-dev',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCapabilityId('  live-video-to-video:scope  ')?.raw).toBe('live-video-to-video:scope');
  });

  it.each(['', '   ', ':', 'a:', ':b', 'a:b:c', 'no-colon', 'bad id:x', 'x:bad id'])(
    'rejects malformed id %p',
    (id) => {
      expect(parseCapabilityId(id)).toBeNull();
      expect(isWellFormedCapabilityId(id)).toBe(false);
    },
  );
});

describe('NAAP-E taxonomy — categories + normalize', () => {
  it('exposes the canonical category set', () => {
    expect(CAPABILITY_CATEGORIES).toEqual(['scope', 'byoc', 'tool']);
  });

  it('classifies tool ids; leaves pipeline/model unclassified (plan decides)', () => {
    expect(categoryOfCapability('tool:yolo-detect')).toBe('tool');
    expect(categoryOfCapability('text-to-image:flux-dev')).toBeNull();
    expect(categoryOfCapability('garbage')).toBeNull();
  });

  it('normalizes: drops malformed + de-duplicates, preserves order', () => {
    expect(
      normalizeCapabilities(['tool:a', 'bad id', 'tool:a', 'x:y', '', 'tool:b']),
    ).toEqual(['tool:a', 'x:y', 'tool:b']);
  });

  it('normalizes a non-array to []', () => {
    expect(normalizeCapabilities(null)).toEqual([]);
    expect(normalizeCapabilities(undefined)).toEqual([]);
  });
});

describe('NAAP-E taxonomy — normalizeProviderCapabilities (O2: canonical `:` format)', () => {
  it('coerces the legacy `<pipeline>/<scope>` slash form to the canonical `:` form', () => {
    expect(normalizeProviderCapabilities(['live-video-to-video/scope'])).toEqual([
      'live-video-to-video:scope',
    ]);
  });

  it('leaves already-canonical colon ids and the wildcard unchanged', () => {
    expect(normalizeProviderCapabilities(['text-to-image:sdxl', '*'])).toEqual([
      'text-to-image:sdxl',
      '*',
    ]);
  });

  it('coerces, de-duplicates across separator variants, and drops malformed ids', () => {
    expect(
      normalizeProviderCapabilities([
        'live-video-to-video/scope',
        'live-video-to-video:scope', // same as the slash form after coercion
        'tool:ffmpeg-concat',
        'garbage',
        '',
      ]),
    ).toEqual(['live-video-to-video:scope', 'tool:ffmpeg-concat']);
  });

  it('only the FIRST separator is coerced (a colon already present wins)', () => {
    // `a:b/c` already has a colon → not coerced → `a:b/c` is malformed → dropped.
    expect(normalizeProviderCapabilities(['a:b/c'])).toEqual([]);
  });

  it('normalizes a non-array to []', () => {
    expect(normalizeProviderCapabilities(null)).toEqual([]);
    expect(normalizeProviderCapabilities(undefined)).toEqual([]);
  });
});
