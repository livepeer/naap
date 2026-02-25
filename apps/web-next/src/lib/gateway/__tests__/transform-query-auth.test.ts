/**
 * Tests for Service Gateway — Query Auth in Transform
 *
 * Verifies query-parameter-based auth injection (e.g. Gemini ?key=...)
 */

import { describe, it, expect } from 'vitest';
import { buildUpstreamRequest } from '../transform';
import type { ResolvedConfig, ResolvedSecrets } from '../types';

function makeConnector(
  overrides?: Partial<ResolvedConfig['connector']>
): ResolvedConfig['connector'] {
  return {
    id: 'conn-1',
    teamId: null,
    ownerUserId: 'user-1',
    slug: 'test-api',
    displayName: 'Test API',
    status: 'published',
    visibility: 'public',
    upstreamBaseUrl: 'https://api.example.com',
    allowedHosts: ['api.example.com'],
    defaultTimeout: 30000,
    healthCheckPath: null,
    authType: 'none',
    authConfig: {},
    secretRefs: [],
    responseWrapper: false,
    streamingEnabled: false,
    errorMapping: {},
    ...overrides,
  };
}

function makeEndpoint(
  overrides?: Partial<ResolvedConfig['endpoint']>
): ResolvedConfig['endpoint'] {
  return {
    id: 'ep-1',
    connectorId: 'conn-1',
    name: 'Generate',
    method: 'POST',
    path: '/generate',
    enabled: true,
    upstreamMethod: null,
    upstreamPath: '/v1/generate',
    upstreamContentType: 'application/json',
    upstreamQueryParams: {},
    upstreamStaticBody: null,
    bodyTransform: 'passthrough',
    headerMapping: {},
    rateLimit: null,
    timeout: null,
    maxRequestSize: null,
    maxResponseSize: null,
    cacheTtl: null,
    retries: 0,
    bodyPattern: null,
    bodyBlacklist: [],
    bodySchema: null,
    requiredHeaders: [],
    ...overrides,
  };
}

function makeRequest(): Request {
  return new Request('https://gateway.example.com/api/v1/gw/test-api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"prompt": "hello"}',
  });
}

describe('Query Auth in buildUpstreamRequest', () => {
  it('appends ?key=value when authType is query', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: 'AIza_test123' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.get('key')).toBe('AIza_test123');
  });

  it('preserves existing upstream query params alongside auth param', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint({
        upstreamQueryParams: { alt: 'json', prettyPrint: 'false' },
      }),
    };
    const secrets: ResolvedSecrets = { token: 'AIza_test123' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.get('key')).toBe('AIza_test123');
    expect(url.searchParams.get('alt')).toBe('json');
    expect(url.searchParams.get('prettyPrint')).toBe('false');
  });

  it('uses configurable paramName', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'api_key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: 'my-secret-key' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.get('api_key')).toBe('my-secret-key');
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('does not add query param when secret is missing', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = {};

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('does not add query param when secret value is empty string', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: '' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.has('key')).toBe(false);
  });

  it('does not set Authorization header for query auth type', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: { paramName: 'key', secretRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: 'AIza_test123' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    expect(result.headers.has('Authorization')).toBe(false);
  });

  it('defaults paramName to "key" and secretRef to "token" when not specified', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'query',
        authConfig: {},
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: 'default-key-value' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.get('key')).toBe('default-key-value');
  });

  it('does not modify URL for non-query auth types', () => {
    const config: ResolvedConfig = {
      connector: makeConnector({
        authType: 'bearer',
        authConfig: { tokenRef: 'token' },
        secretRefs: ['token'],
      }),
      endpoint: makeEndpoint(),
    };
    const secrets: ResolvedSecrets = { token: 'bearer-token' };

    const result = buildUpstreamRequest(makeRequest(), config, secrets, '{"prompt":"hello"}', '/generate');

    const url = new URL(result.url);
    expect(url.searchParams.has('key')).toBe(false);
    expect(result.headers.get('Authorization')).toBe('Bearer bearer-token');
  });
});
