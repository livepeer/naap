/**
 * Connector Regression Matrix
 *
 * Parameterized test covering all 17 connectors to verify their
 * body transform, auth injection, and response handling strategies
 * are correctly resolved by the registry after the SOLID refactor.
 */

import { describe, it, expect } from 'vitest';
import { registry } from '../../transforms';

interface ConnectorSpec {
  slug: string;
  bodyTransforms: string[];
  authType: string;
  responseMode: 'envelope' | 'raw' | 'streaming';
}

const CONNECTOR_MATRIX: ConnectorSpec[] = [
  { slug: 'openai', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'gemini', bodyTransforms: ['passthrough'], authType: 'query', responseMode: 'envelope' },
  { slug: 'daydream', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'livepeer-studio', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'livepeer-leaderboard', bodyTransforms: ['passthrough'], authType: 'none', responseMode: 'envelope' },
  { slug: 'cloudflare-ai', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'clickhouse', bodyTransforms: ['passthrough'], authType: 'basic', responseMode: 'envelope' },
  { slug: 'neon', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'pinecone', bodyTransforms: ['passthrough'], authType: 'header', responseMode: 'envelope' },
  { slug: 'supabase', bodyTransforms: ['passthrough', 'binary'], authType: 'header', responseMode: 'envelope' },
  { slug: 'upstash-redis', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'raw' },
  { slug: 'storj-s3', bodyTransforms: ['binary'], authType: 'aws-s3', responseMode: 'envelope' },
  { slug: 'vercel-blob', bodyTransforms: ['binary'], authType: 'bearer', responseMode: 'raw' },
  { slug: 'stripe', bodyTransforms: ['passthrough', 'form-encode'], authType: 'bearer', responseMode: 'raw' },
  { slug: 'twilio', bodyTransforms: ['passthrough', 'form-encode'], authType: 'basic', responseMode: 'raw' },
  { slug: 'resend', bodyTransforms: ['passthrough'], authType: 'bearer', responseMode: 'envelope' },
  { slug: 'confluent-kafka', bodyTransforms: ['passthrough'], authType: 'basic', responseMode: 'envelope' },
];

describe('Connector regression matrix', () => {
  describe.each(CONNECTOR_MATRIX)('$slug', (spec) => {
    it.each(spec.bodyTransforms)('resolves body transform: %s', (bt) => {
      const strategy = registry.getBody(bt);
      expect(strategy).toBeDefined();
      expect(typeof strategy.transform).toBe('function');
    });

    it(`resolves auth strategy: ${spec.authType}`, () => {
      const strategy = registry.getAuth(spec.authType);
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe(spec.authType);
      expect(typeof strategy.inject).toBe('function');
    });

    it(`resolves response mode: ${spec.responseMode}`, () => {
      const strategy = registry.getResponse(spec.responseMode);
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe(spec.responseMode);
      expect(typeof strategy.transform).toBe('function');
    });
  });
});

describe('Body transform behavioral parity', () => {
  it('passthrough: JSON in = JSON out', () => {
    const s = registry.getBody('passthrough');
    const input = '{"model":"gpt-4","messages":[]}';
    expect(s.transform({ bodyTransform: 'passthrough', consumerBody: input, consumerBodyRaw: null, upstreamStaticBody: null })).toBe(input);
  });

  it('passthrough: null body = undefined', () => {
    const s = registry.getBody('passthrough');
    expect(s.transform({ bodyTransform: 'passthrough', consumerBody: null, consumerBodyRaw: null, upstreamStaticBody: null })).toBeUndefined();
  });

  it('binary: ArrayBuffer in = ArrayBuffer out', () => {
    const s = registry.getBody('binary');
    const buf = new ArrayBuffer(16);
    expect(s.transform({ bodyTransform: 'binary', consumerBody: null, consumerBodyRaw: buf, upstreamStaticBody: null })).toBe(buf);
  });

  it('form-encode: JSON to URL-encoded', () => {
    const s = registry.getBody('form-encode');
    const result = s.transform({ bodyTransform: 'form-encode', consumerBody: '{"amount":2000,"currency":"usd"}', consumerBodyRaw: null, upstreamStaticBody: null });
    expect(result).toContain('amount=2000');
    expect(result).toContain('currency=usd');
  });

  it('extract: nested field extraction', () => {
    const s = registry.getBody('extract:data.sql');
    const result = s.transform({ bodyTransform: 'extract:data.sql', consumerBody: '{"data":{"sql":"SELECT 1"}}', consumerBodyRaw: null, upstreamStaticBody: null });
    expect(result).toBe('"SELECT 1"');
  });
});

describe('Auth injection behavioral parity', () => {
  it('bearer: sets Authorization header (openai, daydream, etc.)', () => {
    const s = registry.getAuth('bearer');
    const h = new Headers();
    s.inject({ headers: h, authConfig: { tokenRef: 'token' }, secrets: { token: 'sk-123' }, method: 'POST', url: new URL('https://api.openai.com/v1/chat') });
    expect(h.get('Authorization')).toBe('Bearer sk-123');
  });

  it('basic: sets base64-encoded Authorization (clickhouse, twilio)', () => {
    const s = registry.getAuth('basic');
    const h = new Headers();
    s.inject({ headers: h, authConfig: { usernameRef: 'username', passwordRef: 'password' }, secrets: { username: 'admin', password: 'pw' }, method: 'POST', url: new URL('https://api.clickhouse.cloud') });
    expect(h.get('Authorization')).toMatch(/^Basic /);
  });

  it('query: appends to URL params (gemini)', () => {
    const s = registry.getAuth('query');
    const h = new Headers();
    const url = new URL('https://generativelanguage.googleapis.com/v1/models');
    s.inject({ headers: h, authConfig: { paramName: 'key', secretRef: 'api_key' }, secrets: { api_key: 'AIza-test' }, method: 'GET', url });
    expect(url.searchParams.get('key')).toBe('AIza-test');
  });

  it('header: sets custom headers (supabase, pinecone)', () => {
    const s = registry.getAuth('header');
    const h = new Headers();
    s.inject({ headers: h, authConfig: { headers: { 'Api-Key': '{{secrets.pk}}' } }, secrets: { pk: 'pine-123' }, method: 'GET', url: new URL('https://api.pinecone.io') });
    expect(h.get('Api-Key')).toBe('pine-123');
  });

  it('none: no headers added (livepeer-leaderboard)', () => {
    const s = registry.getAuth('none');
    const h = new Headers();
    s.inject({ headers: h, authConfig: {}, secrets: {}, method: 'GET', url: new URL('https://leaderboard-api.livepeer.cloud') });
    expect(h.get('Authorization')).toBeNull();
  });
});

describe('Response mode resolution', () => {
  it('envelope: JSON wrapped in {success, data, meta}', async () => {
    const s = registry.getResponse('envelope');
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await s.transform({
      upstreamResponse: upstream,
      connectorSlug: 'gemini',
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 50,
      cached: false,
      requestId: null,
      traceId: null,
    });
    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
    expect(body.meta).toBeDefined();
  });

  it('raw: body passed through (stripe, upstash)', async () => {
    const s = registry.getResponse('raw');
    const upstream = new Response('{"id":"cus_1"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await s.transform({
      upstreamResponse: upstream,
      connectorSlug: 'stripe',
      responseWrapper: false,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 100,
      cached: false,
      requestId: null,
      traceId: null,
    });
    const body = await result.json();
    expect(body).toEqual({ id: 'cus_1' });
  });

  it('streaming: SSE passthrough (openai, gemini, daydream)', () => {
    const s = registry.getResponse('streaming');
    const upstream = new Response('data: test\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const result = s.transform({
      upstreamResponse: upstream,
      connectorSlug: 'openai',
      responseWrapper: true,
      streamingEnabled: true,
      errorMapping: {},
      upstreamLatencyMs: 10,
      cached: false,
      requestId: null,
      traceId: null,
    });
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
