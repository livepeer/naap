/**
 * Tests for Service Gateway — Upstream Proxy
 *
 * Verifies SSRF protection, timeout handling, retry logic,
 * and upstream response forwarding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { proxyToUpstream, ProxyError } from '../proxy';
import { isPrivateHost, validateHost } from '../types';
import type { UpstreamRequest } from '../types';

function makeUpstreamRequest(overrides?: Partial<UpstreamRequest>): UpstreamRequest {
  return {
    url: 'https://api.example.com/v1/query',
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ query: 'SELECT 1' }),
    ...overrides,
  };
}

// ── SSRF Protection (pure functions, no mocking needed) ──

describe('isPrivateHost', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '0.0.0.0',
    '169.254.169.254',
    'localhost',
    '::1',
  ])('identifies %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    'api.example.com',
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '192.167.1.1',
  ])('identifies %s as public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('validateHost', () => {
  it('blocks private IPs regardless of allowedHosts', () => {
    expect(validateHost('127.0.0.1', ['127.0.0.1'])).toBe(false);
    expect(validateHost('localhost', ['localhost'])).toBe(false);
  });

  it('allows any public host when allowedHosts is empty', () => {
    expect(validateHost('api.example.com', [])).toBe(true);
    expect(validateHost('other.service.io', [])).toBe(true);
  });

  it('allows matching host', () => {
    expect(validateHost('api.example.com', ['api.example.com'])).toBe(true);
  });

  it('blocks non-matching host', () => {
    expect(validateHost('evil.com', ['api.example.com'])).toBe(false);
  });

  it('supports wildcard subdomains', () => {
    expect(validateHost('api.example.com', ['*.example.com'])).toBe(true);
    expect(validateHost('staging.example.com', ['*.example.com'])).toBe(true);
    expect(validateHost('example.com', ['*.example.com'])).toBe(true);
    expect(validateHost('api.other.com', ['*.example.com'])).toBe(false);
  });
});

// ── Proxy Function ──

describe('proxyToUpstream', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('proxies request and returns response with latency', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
    );

    const upstream = makeUpstreamRequest();
    const result = await proxyToUpstream(upstream, 30000, 0, ['api.example.com'], false);

    expect(result.response.status).toBe(200);
    expect(result.upstreamLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.cached).toBe(false);
  });

  it('throws SSRF_BLOCKED for private IPs', async () => {
    const upstream = makeUpstreamRequest({ url: 'http://127.0.0.1/admin' });

    await expect(
      proxyToUpstream(upstream, 30000, 0, [], false)
    ).rejects.toThrow(ProxyError);

    try {
      await proxyToUpstream(upstream, 30000, 0, [], false);
    } catch (err) {
      expect((err as ProxyError).code).toBe('SSRF_BLOCKED');
      expect((err as ProxyError).statusCode).toBe(403);
    }
  });

  it('throws SSRF_BLOCKED for host not in allowedHosts', async () => {
    const upstream = makeUpstreamRequest({ url: 'https://evil.com/hack' });

    await expect(
      proxyToUpstream(upstream, 30000, 0, ['api.example.com'], false)
    ).rejects.toThrow(ProxyError);
  });

  it('retries on network failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    globalThis.fetch = fetchMock;

    const upstream = makeUpstreamRequest();
    const result = await proxyToUpstream(upstream, 30000, 1, ['api.example.com'], false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(200);
  });

  it('throws UPSTREAM_UNAVAILABLE after all retries exhausted', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const upstream = makeUpstreamRequest();

    await expect(
      proxyToUpstream(upstream, 30000, 2, ['api.example.com'], false)
    ).rejects.toThrow(ProxyError);

    try {
      await proxyToUpstream(upstream, 30000, 2, ['api.example.com'], false);
    } catch (err) {
      expect((err as ProxyError).code).toBe('UPSTREAM_UNAVAILABLE');
      expect((err as ProxyError).statusCode).toBe(503);
    }
  });
});

describe('ProxyError', () => {
  it('has correct properties', () => {
    const err = new ProxyError('TEST_CODE', 'Test message', 418);

    expect(err.name).toBe('ProxyError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('Test message');
    expect(err.statusCode).toBe(418);
    expect(err).toBeInstanceOf(Error);
  });
});
