import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  providerFetch,
  authenticatedProviderFetch,
  resolveUserId,
  setAuthContext,
} from '../lib/providerFetch.js';

const AUTH_BASE = process.env.SHELL_URL || 'http://localhost:3000';

vi.mock('../lib/SecretStore.js', () => ({
  secretStore: {
    getSecrets: vi.fn(),
  },
}));

describe('providerFetch', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('constructs correct URL from upstreamBaseUrl + path', async () => {
    await providerFetch('https://api.example.com/v1', '/some/path');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/some/path',
      expect.anything(),
    );
  });

  it('sets Content-Type: application/json by default', async () => {
    await providerFetch('https://api.example.com', '/path');
    const [, opts] = mockFetch.mock.calls[0];
    const headers: Headers = opts.headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('calls secretInjector if provided', async () => {
    const injector = vi.fn((headers: Headers) => {
      headers.set('Authorization', 'Bearer secret-token');
    });

    await providerFetch('https://api.example.com', '/path', {}, injector);

    expect(injector).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    const headers: Headers = opts.headers;
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('passes options through', async () => {
    await providerFetch('https://api.example.com', '/path', {
      method: 'POST',
      body: '{"a":1}',
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"a":1}');
  });

  it('does not override explicitly set headers', async () => {
    await providerFetch('https://api.example.com', '/path', {
      headers: { 'X-Custom': 'value' } as Record<string, string>,
    });
    const [, opts] = mockFetch.mock.calls[0];
    const headers: Headers = opts.headers;
    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('returns the fetch response', async () => {
    const mockResponse = { ok: true, status: 200, json: async () => ({ result: true }) };
    mockFetch.mockResolvedValueOnce(mockResponse);
    const res = await providerFetch('https://api.example.com', '/path');
    expect(res).toBe(mockResponse);
  });
});

describe('resolveUserId', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch;
    setAuthContext({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setAuthContext({});
  });

  it('should call /api/v1/auth/me and extract user ID from response', async () => {
    setAuthContext({ authorization: 'Bearer session-token' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { user: { id: 'user-abc123' } } }),
      text: async () => '',
    } as any);

    const userId = await resolveUserId();

    expect(userId).toBe('user-abc123');
    expect(mockFetch).toHaveBeenCalledWith(
      `${AUTH_BASE}/api/v1/auth/me`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      }),
    );
  });

  it('returns null when no authorization in context', async () => {
    setAuthContext({});
    const userId = await resolveUserId();
    expect(userId).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when auth/me returns non-ok', async () => {
    setAuthContext({ authorization: 'Bearer invalid' });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as any);

    const userId = await resolveUserId();
    expect(userId).toBeNull();
  });
});

describe('authenticatedProviderFetch', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch;
    setAuthContext({});
    const { secretStore } = await import('../lib/SecretStore.js');
    vi.mocked(secretStore.getSecrets).mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setAuthContext({});
  });

  it('with authType "none" should call providerFetch without auth', async () => {
    const apiConfig = {
      authType: 'none' as const,
      upstreamBaseUrl: 'https://api.example.com/v1',
      secretNames: [] as string[],
    };

    await authenticatedProviderFetch('my-provider', apiConfig, '/some/path');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/some/path',
      expect.anything(),
    );
    const headers = mockFetch.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBeNull();
  });

  it('with authType "bearer" should inject auth header from SecretStore when user has secrets', async () => {
    setAuthContext({ authorization: 'Bearer provider-test-token' });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { user: { id: 'user-123' } } }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({ ok: true, status: 200 } as any);

    const { secretStore } = await import('../lib/SecretStore.js');
    vi.mocked(secretStore.getSecrets).mockResolvedValue({ apiKey: 'secret-token-xyz' });

    const apiConfig = {
      authType: 'bearer' as const,
      upstreamBaseUrl: 'https://api.example.com/v1',
      secretNames: ['apiKey'],
      authHeaderTemplate: 'Bearer {{secret}}',
      authHeaderName: 'Authorization',
    };

    await authenticatedProviderFetch('my-provider', apiConfig, '/deployments');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      `${AUTH_BASE}/api/v1/auth/me`,
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/v1/deployments',
      expect.anything(),
    );
    const providerCallHeaders = mockFetch.mock.calls[1][1].headers as Headers;
    expect(providerCallHeaders.get('Authorization')).toBe('Bearer secret-token-xyz');
    expect(secretStore.getSecrets).toHaveBeenCalledWith('user-123', 'my-provider');
  });
});
