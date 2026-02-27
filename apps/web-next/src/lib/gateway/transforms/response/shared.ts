/**
 * Shared response utilities used by multiple response strategies.
 */

import type { ResponseTransformContext } from '../types';

const STRIP_HEADERS = new Set([
  'server',
  'x-powered-by',
  'x-aspnet-version',
  'x-aspnetmvc-version',
  'via',
  'set-cookie',
  'content-length',
  'transfer-encoding',
  'content-encoding',
]);

export function buildSafeResponseHeaders(
  ctx: ResponseTransformContext,
  contentType: string,
): Headers {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('X-Gateway-Latency', String(ctx.upstreamLatencyMs));
  headers.set('X-Gateway-Cache', ctx.cached ? 'HIT' : 'MISS');

  if (ctx.requestId) headers.set('x-request-id', ctx.requestId);
  if (ctx.traceId) headers.set('x-trace-id', ctx.traceId);

  ctx.upstreamResponse.headers.forEach((value, key) => {
    if (!STRIP_HEADERS.has(key.toLowerCase()) && !key.startsWith('x-gateway-')) {
      headers.set(key, value);
    }
  });

  return headers;
}
