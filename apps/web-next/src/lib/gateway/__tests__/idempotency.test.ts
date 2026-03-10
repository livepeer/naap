import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();

vi.mock('@naap/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

import { checkIdempotency, storeIdempotency } from '../idempotency';

describe('checkIdempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null on cache miss', async () => {
    mockCacheGet.mockResolvedValue(null);
    const result = await checkIdempotency('team1', 'openai', '/chat', 'key-123', 'POST');
    expect(result).toBeNull();
  });

  it('returns cached response on hit', async () => {
    const cached = { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } };
    mockCacheGet.mockResolvedValue(cached);
    const result = await checkIdempotency('team1', 'openai', '/chat', 'key-123', 'POST');
    expect(result).toEqual(cached);
  });
});

describe('storeIdempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores response with correct key and TTL', async () => {
    mockCacheSet.mockResolvedValue(undefined);
    const response = { status: 200, body: '{"ok":true}', headers: {} };
    await storeIdempotency('team1', 'openai', '/chat', 'key-123', 'POST', response);
    expect(mockCacheSet).toHaveBeenCalledWith(
      'team1:openai:POST:/chat:key-123',
      response,
      { prefix: 'gw:idempotency', ttl: 300 }
    );
  });
});
