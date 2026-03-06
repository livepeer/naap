import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';

export const streamingResponse: ResponseTransformStrategy = {
  name: 'streaming',
  transform(ctx: ResponseTransformContext): Response {
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Gateway-Latency': String(ctx.upstreamLatencyMs),
      'X-Gateway-Cache': ctx.cached ? 'HIT' : 'MISS',
    };

    if (ctx.requestId) headers['x-request-id'] = ctx.requestId;
    if (ctx.traceId) headers['x-trace-id'] = ctx.traceId;

    return new Response(ctx.upstreamResponse.body, {
      status: ctx.upstreamResponse.status,
      headers,
    });
  },
};
