import { describe, it, expect } from 'vitest';
import { streamingResponse } from '../../../transforms/response/streaming';

describe('streaming response strategy', () => {
  it('passes through SSE body with gateway headers', () => {
    const upstream = new Response('data: hello\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });

    const result = streamingResponse.transform({
      upstreamResponse: upstream,
      connectorSlug: 'openai',
      responseWrapper: true,
      streamingEnabled: true,
      errorMapping: {},
      upstreamLatencyMs: 42,
      cached: false,
      requestId: 'req-1',
      traceId: 'trace-1',
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('text/event-stream');
    expect(result.headers.get('X-Gateway-Latency')).toBe('42');
    expect(result.headers.get('X-Gateway-Cache')).toBe('MISS');
    expect(result.headers.get('x-request-id')).toBe('req-1');
  });
});
