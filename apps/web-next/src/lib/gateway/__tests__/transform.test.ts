/**
 * Tests for Service Gateway — Request Transform
 *
 * Verifies URL construction, auth injection, header mapping,
 * body transforms, and secret interpolation.
 */

import { describe, it, expect } from 'vitest';
import { buildUpstreamRequest } from '../transform';
import type { ResolvedConfig, ResolvedSecrets } from '../types';

function makeConfig(overrides?: {
  connector?: Partial<ResolvedConfig['connector']>;
  endpoint?: Partial<ResolvedConfig['endpoint']>;
}): ResolvedConfig {
  return {
    connector: {
      id: 'conn-1',
      teamId: 'team-1',
      ownerUserId: null,
      slug: 'my-api',
      displayName: 'My API',
      status: 'published',
      visibility: 'private',
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
      ...overrides?.connector,
    },
    endpoint: {
      id: 'ep-1',
      connectorId: 'conn-1',
      name: 'Query',
      method: 'POST',
      path: '/query',
      enabled: true,
      upstreamMethod: null,
      upstreamPath: '/v1/query',
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
      ...overrides?.endpoint,
    },
  };
}

describe('buildUpstreamRequest', () => {
  describe('URL construction', () => {
    it('builds upstream URL from base + endpoint path', () => {
      const config = makeConfig();
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.url).toBe('https://api.example.com/v1/query');
    });

    it('strips trailing slash from base URL', () => {
      const config = makeConfig({
        connector: { upstreamBaseUrl: 'https://api.example.com/' },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.url).toBe('https://api.example.com/v1/query');
    });

    it('replaces path params from consumer path', () => {
      const config = makeConfig({
        endpoint: {
          path: '/tables/:name',
          upstreamPath: '/v1/tables/:name',
        },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/tables/users');

      expect(result.url).toBe('https://api.example.com/v1/tables/users');
    });

    it('appends configured query params', () => {
      const config = makeConfig({
        endpoint: {
          upstreamQueryParams: { format: 'json', limit: '100' },
        },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');
      const url = new URL(result.url);

      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('limit')).toBe('100');
    });
  });

  describe('method resolution', () => {
    it('uses endpoint method when no override', () => {
      const config = makeConfig({
        endpoint: { method: 'POST', upstreamMethod: null },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.method).toBe('POST');
    });

    it('uses upstream method override when specified', () => {
      const config = makeConfig({
        endpoint: { method: 'POST', upstreamMethod: 'PUT' },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.method).toBe('PUT');
    });
  });

  describe('auth injection', () => {
    it('injects Bearer token from secrets', () => {
      const config = makeConfig({
        connector: {
          authType: 'bearer',
          authConfig: { tokenRef: 'api-key' },
        },
      });
      const secrets: ResolvedSecrets = { 'api-key': 'sk-test-123' };
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, secrets, null, '/query');

      expect(result.headers.get('Authorization')).toBe('Bearer sk-test-123');
    });

    it('injects custom header auth from secrets', () => {
      const config = makeConfig({
        connector: {
          authType: 'header',
          authConfig: {
            headers: { 'X-API-Key': '{{secrets.apiKey}}' },
          },
        },
      });
      const secrets: ResolvedSecrets = { apiKey: 'my-secret-key' };
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, secrets, null, '/query');

      expect(result.headers.get('X-API-Key')).toBe('my-secret-key');
    });

    it('injects Basic auth from secrets', () => {
      const config = makeConfig({
        connector: {
          authType: 'basic',
          authConfig: { usernameRef: 'user', passwordRef: 'pass' },
        },
      });
      const secrets: ResolvedSecrets = { user: 'admin', pass: 'secret' };
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, secrets, null, '/query');

      const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(result.headers.get('Authorization')).toBe(expected);
    });

    it('sets no auth header for authType=none', () => {
      const config = makeConfig({
        connector: { authType: 'none', authConfig: {} },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.headers.get('Authorization')).toBeNull();
    });
  });

  describe('header mapping', () => {
    it('maps custom headers with secret interpolation', () => {
      const config = makeConfig({
        endpoint: {
          headerMapping: {
            'X-Custom': '{{secrets.custom}}',
            'X-Static': 'fixed-value',
          },
        },
      });
      const secrets: ResolvedSecrets = { custom: 'dynamic-value' };
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, secrets, null, '/query');

      expect(result.headers.get('X-Custom')).toBe('dynamic-value');
      expect(result.headers.get('X-Static')).toBe('fixed-value');
    });

    it('forwards observability headers', () => {
      const config = makeConfig();
      const request = new Request('https://example.com', {
        headers: {
          'x-request-id': 'req-123',
          'x-trace-id': 'trace-456',
        },
      });
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.headers.get('x-request-id')).toBe('req-123');
      expect(result.headers.get('x-trace-id')).toBe('trace-456');
    });
  });

  describe('body transforms', () => {
    it('passes through body in passthrough mode', () => {
      const config = makeConfig({
        endpoint: { bodyTransform: 'passthrough' },
      });
      const request = new Request('https://example.com');
      const body = JSON.stringify({ query: 'SELECT 1' });
      const result = buildUpstreamRequest(request, config, {}, body, '/query');

      expect(result.body).toBe(body);
    });

    it('uses static body in static mode', () => {
      const staticBody = JSON.stringify({ fixed: true });
      const config = makeConfig({
        endpoint: {
          bodyTransform: 'static',
          upstreamStaticBody: staticBody,
        },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, '{"ignored": true}', '/query');

      expect(result.body).toBe(staticBody);
    });

    it('interpolates template with consumer body values', () => {
      const template = '{"model": "{{body.model}}", "prompt": "{{body.prompt}}"}';
      const config = makeConfig({
        endpoint: {
          bodyTransform: 'template',
          upstreamStaticBody: template,
        },
      });
      const request = new Request('https://example.com');
      const consumerBody = JSON.stringify({ model: 'gpt-4', prompt: 'Hello' });
      const result = buildUpstreamRequest(request, config, {}, consumerBody, '/query');

      const parsed = JSON.parse(result.body as string);
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.prompt).toBe('Hello');
    });

    it('extracts nested field from consumer body', () => {
      const config = makeConfig({
        endpoint: { bodyTransform: 'extract:data.query' },
      });
      const request = new Request('https://example.com');
      const consumerBody = JSON.stringify({ data: { query: 'SELECT 1' } });
      const result = buildUpstreamRequest(request, config, {}, consumerBody, '/query');

      expect(result.body).toBe('"SELECT 1"');
    });

    it('returns undefined body when no body and no static body', () => {
      const config = makeConfig({
        endpoint: { bodyTransform: 'passthrough' },
      });
      const request = new Request('https://example.com');
      const result = buildUpstreamRequest(request, config, {}, null, '/query');

      expect(result.body).toBeUndefined();
    });
  });
});
