/**
 * Tests for the server-side internal gateway client.
 *
 * Verifies that callConnectorInternal correctly orchestrates the
 * resolve -> secrets -> transform -> proxy pipeline, including:
 *   - Public connector resolution via internal:system scope
 *   - Env-backed secretsOverride bypassing SecretVault
 *   - baseUrlOverride with dynamic allowedHosts
 *   - NAAP API (no-auth) and ClickHouse (basic-auth) patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../resolve', () => ({
  resolveConfig: vi.fn(),
}));

vi.mock('../proxy', () => ({
  proxyToUpstream: vi.fn(),
  ProxyError: class ProxyError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../secrets', () => ({
  resolveSecrets: vi.fn(),
}));

import { callConnectorInternal } from '../internal-client';
import { resolveConfig } from '../resolve';
import { proxyToUpstream } from '../proxy';
import { resolveSecrets } from '../secrets';
import type { ResolvedConfig } from '../types';

const mockResolveConfig = resolveConfig as ReturnType<typeof vi.fn>;
const mockProxyToUpstream = proxyToUpstream as ReturnType<typeof vi.fn>;
const mockResolveSecrets = resolveSecrets as ReturnType<typeof vi.fn>;

function makePublicNoAuthConfig(): ResolvedConfig {
  return {
    connector: {
      id: 'conn-pub',
      teamId: null,
      ownerUserId: 'admin-1',
      slug: 'example-public-json-api',
      displayName: 'Example Public JSON API',
      status: 'published',
      visibility: 'public',
      upstreamBaseUrl: 'https://api.example.com/v1',
      allowedHosts: ['api.example.com'],
      defaultTimeout: 15000,
      healthCheckPath: '/health',
      authType: 'none',
      authConfig: {},
      secretRefs: [],
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
    },
    endpoint: {
      id: 'ep-data',
      connectorId: 'conn-pub',
      name: 'get-data',
      method: 'GET',
      path: '/data',
      enabled: true,
      upstreamMethod: null,
      upstreamPath: '/data',
      upstreamContentType: 'application/json',
      upstreamQueryParams: {},
      upstreamStaticBody: null,
      bodyTransform: 'passthrough',
      responseBodyTransform: 'none',
      headerMapping: {},
      rateLimit: 100,
      timeout: 10000,
      maxRequestSize: null,
      maxResponseSize: null,
      cacheTtl: 60,
      retries: 0,
      bodyPattern: null,
      bodyBlacklist: [],
      bodySchema: null,
      requiredHeaders: [],
    },
  };
}

function makeClickHouseConfig(): ResolvedConfig {
  return {
    connector: {
      id: 'conn-ch',
      teamId: null,
      ownerUserId: 'admin-1',
      slug: 'clickhouse',
      displayName: 'ClickHouse',
      status: 'published',
      visibility: 'public',
      upstreamBaseUrl: 'https://default-ch.example.com:8443',
      allowedHosts: ['default-ch.example.com'],
      defaultTimeout: 30000,
      healthCheckPath: '/ping',
      authType: 'basic',
      authConfig: { usernameRef: 'username', passwordRef: 'password' },
      secretRefs: ['username', 'password'],
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
    },
    endpoint: {
      id: 'ep-query',
      connectorId: 'conn-ch',
      name: 'query',
      method: 'POST',
      path: '/query',
      enabled: true,
      upstreamMethod: null,
      upstreamPath: '/',
      upstreamContentType: 'text/plain',
      upstreamQueryParams: {},
      upstreamStaticBody: null,
      bodyTransform: 'passthrough',
      responseBodyTransform: 'none',
      headerMapping: {},
      rateLimit: null,
      timeout: 30000,
      maxRequestSize: null,
      maxResponseSize: null,
      cacheTtl: null,
      retries: 0,
      bodyPattern: null,
      bodyBlacklist: [],
      bodySchema: null,
      requiredHeaders: [],
    },
  };
}

function mockProxySuccess(body: unknown, status = 200): void {
  mockProxyToUpstream.mockResolvedValue({
    response: new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
    upstreamLatencyMs: 42,
    cached: false,
  });
}

describe('callConnectorInternal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSecrets.mockResolvedValue({});
  });

  it('resolves config using internal:system scope (public fallback)', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
    });

    expect(mockResolveConfig).toHaveBeenCalledWith(
      'internal:system',
      'example-public-json-api',
      'GET',
      '/data',
    );
  });

  it('throws when no published connector is found', async () => {
    mockResolveConfig.mockResolvedValue(null);

    await expect(
      callConnectorInternal({
        slug: 'nonexistent',
        method: 'GET',
        endpointPath: '/foo',
      }),
    ).rejects.toThrow('No published connector "nonexistent"');
  });

  it('propagates resolveConfig errors', async () => {
    mockResolveConfig.mockRejectedValue(new Error('database unavailable'));

    await expect(
      callConnectorInternal({
        slug: 'example-public-json-api',
        method: 'GET',
        endpointPath: '/data',
      }),
    ).rejects.toThrow('database unavailable');
  });

  // ── NAAP API (no-auth, no secrets) ──

  it('naap-api: does not call resolveSecrets when secretRefs is empty', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
    });

    expect(mockResolveSecrets).not.toHaveBeenCalled();
  });

  it('naap-api: forwards consumer search params to upstream', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
      searchParams: new URLSearchParams({ page: '1', page_size: '200', window: '24h' }),
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    const upstreamUrl = new URL(upstreamCall.url);
    expect(upstreamUrl.searchParams.get('page')).toBe('1');
    expect(upstreamUrl.searchParams.get('page_size')).toBe('200');
    expect(upstreamUrl.searchParams.get('window')).toBe('24h');
  });

  it('naap-api: upstream URL uses connector base + endpoint upstreamPath', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    const upstreamUrl = new URL(upstreamCall.url);
    expect(upstreamUrl.origin).toBe('https://naap-api.livepeer.cloud');
    expect(upstreamUrl.pathname).toBe('/v1/data');
  });

  it('naap-api: no Authorization header for authType=none', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    expect(upstreamCall.headers.get('Authorization')).toBeNull();
  });

  it('naap-api: returns raw upstream response', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [{ id: 1 }] });

    const result = await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
    });

    const body = await result.response.json();
    expect(body).toEqual({ demand: [{ id: 1 }] });
    expect(result.upstreamLatencyMs).toBe(42);
  });

  // ── ClickHouse (basic-auth, env-backed secrets) ──

  it('clickhouse: uses secretsOverride instead of SecretVault', async () => {
    mockResolveConfig.mockResolvedValue(makeClickHouseConfig());
    mockProxySuccess({ data: [] });

    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: 'SELECT 1',
      secretsOverride: { username: 'env-user', password: 'env-pass' },
      baseUrlOverride: 'https://my-ch.example.com:8443',
    });

    expect(mockResolveSecrets).not.toHaveBeenCalled();
  });

  it('clickhouse: injects Basic auth from secretsOverride', async () => {
    mockResolveConfig.mockResolvedValue(makeClickHouseConfig());
    mockProxySuccess({ data: [] });

    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: 'SELECT 1',
      secretsOverride: { username: 'admin', password: 's3cret' },
      baseUrlOverride: 'https://my-ch.example.com:8443',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    const expected = `Basic ${Buffer.from('admin:s3cret').toString('base64')}`;
    expect(upstreamCall.headers.get('Authorization')).toBe(expected);
  });

  it('clickhouse: baseUrlOverride changes upstream URL and allowedHosts', async () => {
    mockResolveConfig.mockResolvedValue(makeClickHouseConfig());
    mockProxySuccess({ data: [] });

    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: 'SELECT 1',
      secretsOverride: { username: 'u', password: 'p' },
      baseUrlOverride: 'https://runtime-ch.example.com:8443',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    const upstreamUrl = new URL(upstreamCall.url);
    expect(upstreamUrl.hostname).toBe('runtime-ch.example.com');
    expect(upstreamUrl.port).toBe('8443');

    const allowedHostsArg = mockProxyToUpstream.mock.calls[0][3];
    expect(allowedHostsArg).toEqual(['runtime-ch.example.com']);
  });

  it('clickhouse: passes SQL body through as text/plain', async () => {
    mockResolveConfig.mockResolvedValue(makeClickHouseConfig());
    mockProxySuccess({ data: [] });

    const sql = 'SELECT count() FROM events FORMAT JSON';
    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: sql,
      secretsOverride: { username: 'u', password: 'p' },
      baseUrlOverride: 'https://ch.example.com:8443',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    expect(upstreamCall.body).toBe(sql);
    expect(upstreamCall.headers.get('Content-Type')).toBe('text/plain');
  });

  it('clickhouse: forwards search params (e.g. parameterized queries)', async () => {
    mockResolveConfig.mockResolvedValue(makeClickHouseConfig());
    mockProxySuccess({ data: [] });

    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: 'SELECT 1 WHERE x = {filter:String} FORMAT JSON',
      searchParams: new URLSearchParams({ param_filter: 'test' }),
      secretsOverride: { username: 'u', password: 'p' },
      baseUrlOverride: 'https://ch.example.com:8443',
    });

    const upstreamCall = mockProxyToUpstream.mock.calls[0][0];
    const upstreamUrl = new URL(upstreamCall.url);
    expect(upstreamUrl.searchParams.get('param_filter')).toBe('test');
  });

  // ── SecretVault fallback (non-overridden) ──

  it('falls back to SecretVault when no secretsOverride is provided', async () => {
    const config = makeClickHouseConfig();
    mockResolveConfig.mockResolvedValue(config);
    mockResolveSecrets.mockResolvedValue({ username: 'db-user', password: 'db-pass' });
    mockProxySuccess({ data: [] });

    await callConnectorInternal({
      slug: 'clickhouse',
      method: 'POST',
      endpointPath: '/query',
      body: 'SELECT 1',
    });

    expect(mockResolveSecrets).toHaveBeenCalledWith(
      'personal:admin-1',
      ['username', 'password'],
      null,
      'clickhouse',
    );
  });

  // ── Timeout override ──

  it('uses caller-provided timeout over connector/endpoint defaults', async () => {
    mockResolveConfig.mockResolvedValue(makePublicNoAuthConfig());
    mockProxySuccess({ demand: [] });

    await callConnectorInternal({
      slug: 'example-public-json-api',
      method: 'GET',
      endpointPath: '/data',
      timeout: 5_000,
    });

    const timeoutArg = mockProxyToUpstream.mock.calls[0][1];
    expect(timeoutArg).toBe(5_000);
  });
});
