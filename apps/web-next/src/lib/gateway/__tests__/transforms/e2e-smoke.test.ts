/**
 * End-to-End Smoke Tests
 *
 * Verifies that the full buildUpstreamRequest → buildResponse pipeline
 * works correctly for representative connector configs.
 *
 * These tests simulate the transform + respond steps without network I/O.
 */

import { describe, it, expect } from 'vitest';
import { buildUpstreamRequest } from '../../transform';
import { buildResponse } from '../../respond';
import '../../transforms';
import type { ResolvedConfig, ResolvedSecrets, ProxyResult } from '../../types';

function makeConfig(overrides: {
  slug?: string;
  authType?: string;
  authConfig?: Record<string, unknown>;
  responseWrapper?: boolean;
  streamingEnabled?: boolean;
  bodyTransform?: string;
  upstreamPath?: string;
  upstreamContentType?: string;
  method?: string;
  path?: string;
}): ResolvedConfig {
  return {
    connector: {
      id: 'conn-1',
      teamId: 'team-1',
      ownerUserId: null,
      slug: overrides.slug || 'test',
      displayName: 'Test',
      status: 'published',
      visibility: 'public',
      upstreamBaseUrl: 'https://api.example.com',
      allowedHosts: ['api.example.com'],
      defaultTimeout: 30000,
      healthCheckPath: null,
      authType: overrides.authType || 'bearer',
      authConfig: overrides.authConfig || { tokenRef: 'token' },
      secretRefs: ['token'],
      responseWrapper: overrides.responseWrapper ?? true,
      streamingEnabled: overrides.streamingEnabled ?? false,
      errorMapping: {},
    },
    endpoint: {
      id: 'ep-1',
      connectorId: 'conn-1',
      name: 'test-endpoint',
      method: overrides.method || 'POST',
      path: overrides.path || '/test',
      enabled: true,
      upstreamMethod: null,
      upstreamPath: overrides.upstreamPath || '/v1/test',
      upstreamContentType: overrides.upstreamContentType || 'application/json',
      upstreamQueryParams: {},
      upstreamStaticBody: null,
      bodyTransform: overrides.bodyTransform || 'passthrough',
      responseBodyTransform: 'none',
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
    },
  };
}

describe('E2E smoke: request transform pipeline', () => {
  it('OpenAI-style: passthrough + bearer', () => {
    const config = makeConfig({ slug: 'openai', authType: 'bearer' });
    const secrets: ResolvedSecrets = { token: 'sk-test' };
    const request = new Request('https://naap.dev/api/v1/gw/openai/test', {
      method: 'POST',
      body: '{"model":"gpt-4"}',
      headers: { 'content-type': 'application/json' },
    });

    const result = buildUpstreamRequest(request, config, secrets, '{"model":"gpt-4"}', '/test');
    expect(result.url).toBe('https://api.example.com/v1/test');
    expect(result.method).toBe('POST');
    expect(result.headers.get('Authorization')).toBe('Bearer sk-test');
    expect(result.body).toBe('{"model":"gpt-4"}');
  });

  it('Gemini-style: passthrough + query auth', () => {
    const config = makeConfig({ slug: 'gemini', authType: 'query', authConfig: { paramName: 'key', secretRef: 'api_key' } });
    const secrets: ResolvedSecrets = { api_key: 'AIza-test' };
    const request = new Request('https://naap.dev/api/v1/gw/gemini/test', {
      method: 'POST',
      body: '{"contents":[]}',
      headers: { 'content-type': 'application/json' },
    });

    const result = buildUpstreamRequest(request, config, secrets, '{"contents":[]}', '/test');
    expect(result.url).toContain('key=AIza-test');
    expect(result.headers.get('Authorization')).toBeNull();
  });

  it('Stripe-style: form-encode + bearer', () => {
    const config = makeConfig({
      slug: 'stripe',
      bodyTransform: 'form-encode',
      upstreamContentType: 'application/x-www-form-urlencoded',
    });
    const secrets: ResolvedSecrets = { token: 'sk_test_stripe' };
    const request = new Request('https://naap.dev/api/v1/gw/stripe/test', {
      method: 'POST',
      body: '{"amount":2000,"currency":"usd"}',
      headers: { 'content-type': 'application/json' },
    });

    const result = buildUpstreamRequest(request, config, secrets, '{"amount":2000,"currency":"usd"}', '/test');
    expect(result.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(result.body).toContain('amount=2000');
    expect(result.body).toContain('currency=usd');
    expect(result.headers.get('Authorization')).toBe('Bearer sk_test_stripe');
  });

  it('Storj-style: binary + aws-s3', () => {
    const config = makeConfig({
      slug: 'storj-s3',
      authType: 'aws-s3',
      authConfig: { accessKeyRef: 'access_key', secretKeyRef: 'secret_key', region: 'us-east-1', service: 's3' },
      bodyTransform: 'binary',
    });
    const secrets: ResolvedSecrets = { access_key: 'AKTEST', secret_key: 'secret123' };
    const buf = new ArrayBuffer(4);
    const request = new Request('https://naap.dev/api/v1/gw/storj-s3/test', {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
    });

    const result = buildUpstreamRequest(request, config, secrets, null, '/test', buf);
    expect(result.body).toBe(buf);
    expect(result.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256/);
  });
});

describe('E2E smoke: response pipeline', () => {
  it('envelope mode wraps JSON', async () => {
    const config = makeConfig({ responseWrapper: true });
    const proxyResult: ProxyResult = {
      response: new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      upstreamLatencyMs: 42,
      cached: false,
    };

    const result = await buildResponse(config, proxyResult, 'req-1', 'trace-1');
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
    expect(body.meta.connector).toBe('test');
  });

  it('raw mode passes through', async () => {
    const config = makeConfig({ responseWrapper: false });
    const proxyResult: ProxyResult = {
      response: new Response('{"id":"cus_1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      upstreamLatencyMs: 100,
      cached: false,
    };

    const result = await buildResponse(config, proxyResult, null, null);
    const body = await result.json();
    expect(body).toEqual({ id: 'cus_1' });
  });

  it('streaming mode passes SSE through', async () => {
    const config = makeConfig({ streamingEnabled: true, responseWrapper: true });
    const proxyResult: ProxyResult = {
      response: new Response('data: hello\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      upstreamLatencyMs: 5,
      cached: false,
    };

    const result = await buildResponse(config, proxyResult, null, null);
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
