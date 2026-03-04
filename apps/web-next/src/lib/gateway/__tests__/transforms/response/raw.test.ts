import { describe, it, expect } from 'vitest';
import { rawResponse } from '../../../transforms/response/raw';

describe('raw response strategy', () => {
  it('passes body through without envelope wrapping', async () => {
    const upstream = new Response(JSON.stringify({ id: 'cus_123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const result = await rawResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'stripe',
      responseWrapper: false,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 200,
      cached: false,
      requestId: 'req-3',
      traceId: null,
    });

    const body = await result.json();
    expect(body).toEqual({ id: 'cus_123' });
    expect(result.headers.get('X-Gateway-Latency')).toBe('200');
    expect(result.headers.get('x-request-id')).toBe('req-3');
  });

  it('handles binary content', async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const upstream = new Response(buf, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });

    const result = await rawResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'storj-s3',
      responseWrapper: false,
      streamingEnabled: false,
      errorMapping: {},
      upstreamLatencyMs: 50,
      cached: false,
      requestId: null,
      traceId: null,
    });

    const body = await result.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(buf);
  });
});
