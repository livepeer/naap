/**
 * Tests for Service Gateway — Response Cache
 *
 * Verifies cache hit/miss, expiration, eviction, key building,
 * and invalidation.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCachedResponse,
  setCachedResponse,
  buildCacheKey,
  invalidateResponseCache,
  getResponseCacheSize,
  clearResponseCache,
} from '../cache';

function makeBody(text = 'test'): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('buildCacheKey', () => {
  it('produces deterministic keys for same inputs', () => {
    const a = buildCacheKey('team-1', 'api', 'GET', '/foo', null);
    const b = buildCacheKey('team-1', 'api', 'GET', '/foo', null);
    expect(a).toBe(b);
  });

  it('produces different keys for different scopes', () => {
    const a = buildCacheKey('team-1', 'api', 'GET', '/foo', null);
    const b = buildCacheKey('team-2', 'api', 'GET', '/foo', null);
    expect(a).not.toBe(b);
  });

  it('includes body hash when body is present', () => {
    const a = buildCacheKey('team-1', 'api', 'GET', '/foo', null);
    const b = buildCacheKey('team-1', 'api', 'GET', '/foo', '{"q":1}');
    expect(a).not.toBe(b);
  });
});

describe('getCachedResponse / setCachedResponse', () => {
  beforeEach(() => clearResponseCache());

  it('returns null for a cache miss', () => {
    expect(getCachedResponse('nonexistent')).toBeNull();
  });

  it('returns the cached entry on hit', () => {
    const body = makeBody('response data');
    setCachedResponse('key-1', { body, status: 200, headers: { 'content-type': 'application/json' } }, 60);
    const cached = getCachedResponse('key-1');
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe(200);
    expect(cached!.headers['content-type']).toBe('application/json');
    expect(new TextDecoder().decode(cached!.body)).toBe('response data');
  });

  it('returns null for expired entries', () => {
    vi.useFakeTimers();
    setCachedResponse('key-exp', { body: makeBody(), status: 200, headers: {} }, 10);
    expect(getCachedResponse('key-exp')).not.toBeNull();

    vi.advanceTimersByTime(11_000);
    expect(getCachedResponse('key-exp')).toBeNull();
    vi.useRealTimers();
  });

  it('evicts oldest entry when at max capacity', () => {
    for (let i = 0; i < 1001; i++) {
      setCachedResponse(`key-${i}`, { body: makeBody(), status: 200, headers: {} }, 300);
    }
    expect(getResponseCacheSize()).toBeLessThanOrEqual(1000);
  });
});

describe('invalidateResponseCache', () => {
  beforeEach(() => clearResponseCache());

  it('removes all entries for a given scope + slug', () => {
    setCachedResponse('gw:resp:team-1:api:GET:/foo:nobody', { body: makeBody(), status: 200, headers: {} }, 60);
    setCachedResponse('gw:resp:team-1:api:POST:/bar:abc', { body: makeBody(), status: 200, headers: {} }, 60);
    setCachedResponse('gw:resp:team-2:api:GET:/foo:nobody', { body: makeBody(), status: 200, headers: {} }, 60);

    invalidateResponseCache('team-1', 'api');

    expect(getCachedResponse('gw:resp:team-1:api:GET:/foo:nobody')).toBeNull();
    expect(getCachedResponse('gw:resp:team-1:api:POST:/bar:abc')).toBeNull();
    expect(getCachedResponse('gw:resp:team-2:api:GET:/foo:nobody')).not.toBeNull();
  });
});

describe('clearResponseCache', () => {
  beforeEach(() => clearResponseCache());

  it('empties the cache', () => {
    setCachedResponse('key-a', { body: makeBody(), status: 200, headers: {} }, 60);
    setCachedResponse('key-b', { body: makeBody(), status: 200, headers: {} }, 60);
    expect(getResponseCacheSize()).toBe(2);

    clearResponseCache();
    expect(getResponseCacheSize()).toBe(0);
  });
});
