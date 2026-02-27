import { describe, it, expect } from 'vitest';
import { envelopeResponse } from '../../../transforms/response/envelope';

describe('envelope response strategy', () => {
  it('wraps JSON response in NaaP envelope', async () => {
    const upstream = new Response(JSON.stringify({ result: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const result = await envelopeResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'gemini',
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 100,
      cached: false,
      requestId: 'req-2',
      traceId: 'trace-2',
    });

    const body = await result.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ result: 'ok' });
    expect(body.meta.connector).toBe('gemini');
    expect(body.meta.upstreamStatus).toBe(200);
    expect(body.meta.latencyMs).toBe(100);
  });

  it('includes error mapping for non-2xx responses', async () => {
    const upstream = new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });

    const result = await envelopeResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'test',
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: { '404': 'Resource not found on upstream' },
      upstreamLatencyMs: 50,
      cached: false,
      requestId: null,
      traceId: null,
    });

    const body = await result.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UPSTREAM_404');
    expect(body.error.message).toBe('Resource not found on upstream');
  });

  it('strips sensitive headers from upstream response', async () => {
    const upstream = new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'server': 'nginx',
        'x-powered-by': 'Express',
        'set-cookie': 'session=abc',
        'x-custom': 'keep-me',
      },
    });

    const result = await envelopeResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'test',
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 10,
      cached: false,
      requestId: null,
      traceId: null,
    });

    expect(result.headers.get('server')).toBeNull();
    expect(result.headers.get('x-powered-by')).toBeNull();
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('x-custom')).toBe('keep-me');
  });

  it('falls through to raw passthrough for non-JSON', async () => {
    const upstream = new Response('<html>hi</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

    const result = await envelopeResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'test',
      responseWrapper: true,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 10,
      cached: false,
      requestId: null,
      traceId: null,
    });

    const text = await result.text();
    expect(text).toBe('<html>hi</html>');
  });
});
