/**
 * Tests verifying all quality review fixes (P0–P3).
 * Each section maps to an issue from the Gateway Quality Review plan.
 */

import { describe, it, expect } from 'vitest';
import { validateHost, isPrivateHost } from '../types';
import { interpolateSecrets } from '../transforms/types';
import { registry } from '../transforms';

// ── BUG-3: Wildcard Hostname Validation ───────────────────────────────────

describe('validateHost — wildcard subdomain boundary (BUG-3 fix)', () => {
  it('matches exact subdomain of wildcard', () => {
    expect(validateHost('api.example.com', ['*.example.com'])).toBe(true);
    expect(validateHost('staging.example.com', ['*.example.com'])).toBe(true);
  });

  it('matches the base domain itself', () => {
    expect(validateHost('example.com', ['*.example.com'])).toBe(true);
  });

  it('rejects hostnames that merely end with the domain string', () => {
    expect(validateHost('evil-example.com', ['*.example.com'])).toBe(false);
    expect(validateHost('notexample.com', ['*.example.com'])).toBe(false);
  });

  it('rejects private IPs regardless of allowlist', () => {
    expect(validateHost('127.0.0.1', ['*.example.com'])).toBe(false);
    expect(validateHost('localhost', ['*.example.com'])).toBe(false);
    expect(validateHost('10.0.0.1', ['*.example.com'])).toBe(false);
    expect(validateHost('192.168.1.1', ['*.example.com'])).toBe(false);
  });

  it('matches exact hostnames', () => {
    expect(validateHost('api.example.com', ['api.example.com'])).toBe(true);
    expect(validateHost('other.example.com', ['api.example.com'])).toBe(false);
  });

  it('allows any host when allowedHosts is empty', () => {
    expect(validateHost('anything.com', [])).toBe(true);
  });
});

// ── MED-1: interpolateSecrets regex supports hyphens ──────────────────────

describe('interpolateSecrets — hyphenated secret names (MED-1 fix)', () => {
  it('interpolates secrets with hyphens in names', () => {
    const result = interpolateSecrets(
      'key={{secrets.api-key}}&token={{secrets.auth-token}}',
      { 'api-key': 'sk_123', 'auth-token': 'tok_456' }
    );
    expect(result).toBe('key=sk_123&token=tok_456');
  });

  it('still handles underscore secret names', () => {
    const result = interpolateSecrets(
      '{{secrets.my_key}}',
      { 'my_key': 'value' }
    );
    expect(result).toBe('value');
  });

  it('returns empty string for missing secrets', () => {
    const result = interpolateSecrets('key={{secrets.missing}}', {});
    expect(result).toBe('key=');
  });
});

// ── MED-6: Response registry fallback to raw ─────────────────────────────

describe('TransformRegistry — response fallback to raw (MED-6 fix)', () => {
  it('falls back to raw for unknown response transform names', () => {
    const s = registry.getResponse('nonexistent-mode');
    expect(s.name).toBe('raw');
  });

  it('still resolves known response transforms', () => {
    expect(registry.getResponse('envelope').name).toBe('envelope');
    expect(registry.getResponse('streaming').name).toBe('streaming');
    expect(registry.getResponse('field-map').name).toBe('field-map');
  });
});

// ── BUG-2: Field-map strategy actually applies mappings ──────────────────

describe('field-map response strategy (BUG-2 fix)', () => {
  const strategy = registry.getResponse('field-map');

  function makeCtx(body: unknown, rbt: string) {
    return {
      upstreamResponse: new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
      connectorSlug: 'test',
      responseWrapper: false,
      streamingEnabled: false,
      errorMapping: {},
      responseBodyTransform: rbt,
      upstreamLatencyMs: 10,
      cached: false,
      requestId: 'req-1',
      traceId: 'trace-1',
    };
  }

  it('maps source fields to target fields', async () => {
    const response = await strategy.transform(
      makeCtx(
        { items: [1, 2, 3], total_count: 3, extra: 'ignored' },
        'field-map:items->data,total_count->meta.total'
      )
    );
    const result = await response.json();
    expect(result).toEqual({ data: [1, 2, 3], meta: { total: 3 } });
  });

  it('handles nested source fields', async () => {
    const response = await strategy.transform(
      makeCtx(
        { response: { results: [{ id: 1 }] } },
        'field-map:response.results->items'
      )
    );
    const result = await response.json();
    expect(result).toEqual({ items: [{ id: 1 }] });
  });

  it('passes through unchanged when no mapping spec provided', async () => {
    const original = { a: 1, b: 2 };
    const response = await strategy.transform(
      makeCtx(original, 'field-map:')
    );
    const result = await response.json();
    expect(result).toEqual(original);
  });

  it('passes through non-JSON responses unchanged', async () => {
    const ctx = {
      upstreamResponse: new Response('plain text', {
        headers: { 'content-type': 'text/plain' },
      }),
      connectorSlug: 'test',
      responseWrapper: false,
      streamingEnabled: false,
      errorMapping: {},
      responseBodyTransform: 'field-map:a->b',
      upstreamLatencyMs: 10,
      cached: false,
      requestId: 'req-1',
      traceId: 'trace-1',
    };
    const response = await strategy.transform(ctx);
    const text = await response.text();
    expect(text).toBe('plain text');
  });
});
