/**
 * Tests for Service Gateway — Request Validation
 *
 * Verifies required headers, body pattern, keyword blacklist,
 * and JSON schema validation.
 */

import { describe, it, expect } from 'vitest';
import { validateRequest } from '../validate';
import type { ResolvedEndpoint } from '../types';

function makeEndpoint(overrides?: Partial<ResolvedEndpoint>): ResolvedEndpoint {
  return {
    id: 'ep-1',
    connectorId: 'conn-1',
    name: 'Test Endpoint',
    method: 'POST',
    path: '/test',
    enabled: true,
    upstreamMethod: null,
    upstreamPath: '/upstream/test',
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

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/test', {
    method: 'POST',
    headers: new Headers(headers),
  });
}

describe('validateRequest', () => {
  describe('required headers', () => {
    it('rejects when a required header is missing', () => {
      const ep = makeEndpoint({ requiredHeaders: ['X-Custom-Header'] });
      const result = validateRequest(makeRequest(), ep, '{"data": 1}');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('X-Custom-Header');
    });

    it('passes when all required headers are present', () => {
      const ep = makeEndpoint({ requiredHeaders: ['X-Custom-Header'] });
      const result = validateRequest(
        makeRequest({ 'X-Custom-Header': 'value' }),
        ep,
        '{"data": 1}'
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('body pattern', () => {
    it('rejects when body does not match pattern', () => {
      const ep = makeEndpoint({ bodyPattern: '^\\s*SELECT\\b' });
      const result = validateRequest(makeRequest(), ep, 'DROP TABLE users');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern');
    });

    it('passes when body matches pattern', () => {
      const ep = makeEndpoint({ bodyPattern: '^\\s*SELECT\\b' });
      const result = validateRequest(makeRequest(), ep, 'SELECT * FROM users');
      expect(result.valid).toBe(true);
    });
  });

  describe('body blacklist', () => {
    it('rejects when body contains a blacklisted keyword', () => {
      const ep = makeEndpoint({ bodyBlacklist: ['DROP', 'DELETE'] });
      const result = validateRequest(makeRequest(), ep, 'DROP TABLE users');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DROP');
    });

    it('is case-insensitive', () => {
      const ep = makeEndpoint({ bodyBlacklist: ['DROP'] });
      const result = validateRequest(makeRequest(), ep, 'drop table users');
      expect(result.valid).toBe(false);
    });

    it('passes when body has no blacklisted keywords', () => {
      const ep = makeEndpoint({ bodyBlacklist: ['DROP', 'DELETE'] });
      const result = validateRequest(makeRequest(), ep, 'SELECT * FROM users');
      expect(result.valid).toBe(true);
    });
  });

  describe('JSON schema validation', () => {
    it('rejects when body is not valid JSON', () => {
      const ep = makeEndpoint({ bodySchema: { type: 'object' } });
      const result = validateRequest(makeRequest(), ep, 'not json');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });

    it('rejects when body type does not match schema', () => {
      const ep = makeEndpoint({ bodySchema: { type: 'object' } });
      const result = validateRequest(makeRequest(), ep, '"a string"');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON object');
    });

    it('rejects when required fields are missing', () => {
      const ep = makeEndpoint({
        bodySchema: { type: 'object', required: ['model', 'messages'] },
      });
      const result = validateRequest(makeRequest(), ep, '{"model": "gpt-4"}');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('messages');
    });

    it('rejects when field type is wrong', () => {
      const ep = makeEndpoint({
        bodySchema: {
          type: 'object',
          properties: { count: { type: 'number' } },
        },
      });
      const result = validateRequest(makeRequest(), ep, '{"count": "not a number"}');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('count');
    });

    it('passes valid JSON against schema', () => {
      const ep = makeEndpoint({
        bodySchema: {
          type: 'object',
          required: ['model'],
          properties: { model: { type: 'string' } },
        },
      });
      const result = validateRequest(makeRequest(), ep, '{"model": "gpt-4"}');
      expect(result.valid).toBe(true);
    });
  });

  describe('no body', () => {
    it('passes when there is no body and no header requirements', () => {
      const ep = makeEndpoint();
      const result = validateRequest(makeRequest(), ep, null);
      expect(result.valid).toBe(true);
    });
  });
});
