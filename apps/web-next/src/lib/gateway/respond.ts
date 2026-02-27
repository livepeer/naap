/**
 * Service Gateway — Response Builder (Orchestrator)
 *
 * Delegates response construction to the strategy registry.
 * Resolves the correct response mode based on connector config and
 * upstream content type.
 */

import { NextResponse } from 'next/server';
import type { ResolvedConfig, ProxyResult } from './types';
import { registry } from './transforms';

/**
 * Build the consumer-facing response from upstream response.
 */
export function buildResponse(
  config: ResolvedConfig,
  proxyResult: ProxyResult,
  requestId: string | null,
  traceId: string | null
): Response | Promise<Response> {
  const { response, upstreamLatencyMs, cached } = proxyResult;
  const { connector, endpoint } = config;

  const responseContentType = response.headers.get('content-type') || '';
  const rbt = endpoint.responseBodyTransform || 'none';
  const mode = resolveResponseMode(connector, responseContentType, rbt);

  const strategy = registry.getResponse(mode);
  return strategy.transform({
    upstreamResponse: response,
    connectorSlug: connector.slug,
    responseWrapper: connector.responseWrapper,
    streamingEnabled: connector.streamingEnabled,
    errorMapping: connector.errorMapping,
    responseBodyTransform: rbt,
    upstreamLatencyMs,
    cached,
    requestId,
    traceId,
  });
}

/**
 * Determine which response strategy to use based on connector config,
 * the upstream response content type, and any endpoint-level response
 * body transform.
 */
function resolveResponseMode(
  connector: ResolvedConfig['connector'],
  responseContentType: string,
  responseBodyTransform: string,
): string {
  if (connector.streamingEnabled && responseContentType.includes('text/event-stream')) {
    return 'streaming';
  }
  if (responseBodyTransform.startsWith('field-map')) {
    return 'field-map';
  }
  if (connector.responseWrapper) {
    return 'envelope';
  }
  return 'raw';
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
  details?: unknown
): NextResponse {
  const body = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;

  return NextResponse.json(body, { status: statusCode, headers });
}
