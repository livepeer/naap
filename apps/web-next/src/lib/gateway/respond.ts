/**
 * Service Gateway — Response Builder
 *
 * Wraps upstream responses in NaaP envelope format, strips sensitive
 * headers, and handles SSE streaming passthrough.
 */

import { NextResponse } from 'next/server';
import type { ResolvedConfig, ProxyResult } from './types';

/**
 * Headers to strip from upstream responses (security + noise).
 */
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
  'etag',
  'last-modified',
]);

/**
 * Build the consumer-facing response from upstream response.
 */
export function buildResponse(
  config: ResolvedConfig,
  proxyResult: ProxyResult,
  requestId: string | null,
  traceId: string | null
): Response {
  const { response, upstreamLatencyMs, cached } = proxyResult;
  const { connector } = config;

  const responseContentType = response.headers.get('content-type') || '';

  // ── SSE Streaming — passthrough without wrapping ──
  if (connector.streamingEnabled && responseContentType.toLowerCase().includes('text/event-stream')) {
    return buildStreamingResponse(response, requestId, traceId, upstreamLatencyMs, cached);
  }

  // ── Standard Response ──
  return buildStandardResponse(
    config,
    response,
    requestId,
    traceId,
    upstreamLatencyMs,
    cached
  );
}

/**
 * Build SSE streaming response — passthrough with gateway headers.
 */
function buildStreamingResponse(
  upstreamResponse: Response,
  requestId: string | null,
  traceId: string | null,
  upstreamLatencyMs: number,
  cached: boolean
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Gateway-Latency': String(upstreamLatencyMs),
    'X-Gateway-Cache': cached ? 'HIT' : 'MISS',
  };

  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}

/**
 * Build standard JSON/binary response — optionally wrapped in NaaP envelope.
 */
async function buildStandardResponse(
  config: ResolvedConfig,
  upstreamResponse: Response,
  requestId: string | null,
  traceId: string | null,
  upstreamLatencyMs: number,
  cached: boolean
): Promise<Response> {
  const { connector } = config;
  const contentType = upstreamResponse.headers.get('content-type') || 'application/json';

  // Copy safe upstream headers first
  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (!STRIP_HEADERS.has(key.toLowerCase()) && !key.startsWith('x-gateway-')) {
      responseHeaders.set(key, value);
    }
  });

  // Set gateway headers AFTER upstream to prevent spoofing
  responseHeaders.set('Content-Type', contentType);
  responseHeaders.set('X-Gateway-Latency', String(upstreamLatencyMs));
  responseHeaders.set('X-Gateway-Cache', cached ? 'HIT' : 'MISS');

  if (requestId) responseHeaders.set('x-request-id', requestId);
  if (traceId) responseHeaders.set('x-trace-id', traceId);

  // ── Envelope wrapping ──
  if (connector.responseWrapper && contentType.includes('application/json')) {
    try {
      const body = await upstreamResponse.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body;
      }

      const envelope = {
        success: upstreamResponse.ok,
        data: parsedBody,
        meta: {
          connector: connector.slug,
          upstreamStatus: upstreamResponse.status,
          latencyMs: upstreamLatencyMs,
          cached,
          timestamp: new Date().toISOString(),
        },
      };

      // Map error codes if configured
      if (!upstreamResponse.ok && connector.errorMapping) {
        const mappedMessage = connector.errorMapping[String(upstreamResponse.status)];
        if (mappedMessage) {
          (envelope as Record<string, unknown>).error = {
            code: `UPSTREAM_${upstreamResponse.status}`,
            message: mappedMessage,
          };
        }
      }

      responseHeaders.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(envelope), {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch {
      // If parsing fails, fall through to raw passthrough
    }
  }

  // ── Raw passthrough (non-JSON or wrapper disabled) ──
  const body = await upstreamResponse.arrayBuffer();
  return new Response(body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

/**
 * Build a gateway error response in NaaP envelope format.
 */
export function buildErrorResponse(
  code: string,
  message: string,
  statusCode: number,
  requestId: string | null,
  traceId: string | null,
  extraHeaders?: Record<string, string>
): NextResponse {
  const body = {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  const headers: Record<string, string> = { ...extraHeaders };
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return NextResponse.json(body, { status: statusCode, headers });
}
