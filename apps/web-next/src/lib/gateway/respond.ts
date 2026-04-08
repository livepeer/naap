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
export async function buildResponse(
  config: ResolvedConfig,
  proxyResult: ProxyResult,
  requestId: string | null,
  traceId: string | null
): Promise<Response> {
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
 * Error recovery metadata for agent-friendly error handling.
 * Agents use retryable + suggestedAction to decide next steps automatically.
 */
const ERROR_RECOVERY: Record<string, { retryable: boolean; suggestedAction: string; retryAfterMs?: number }> = {
  RATE_LIMITED:          { retryable: true,  suggestedAction: 'retry', retryAfterMs: 5000 },
  UPSTREAM_TIMEOUT:      { retryable: true,  suggestedAction: 'retry' },
  UPSTREAM_UNAVAILABLE:  { retryable: true,  suggestedAction: 'retry' },
  UPSTREAM_ERROR:        { retryable: true,  suggestedAction: 'retry' },
  CIRCUIT_OPEN:          { retryable: true,  suggestedAction: 'retry', retryAfterMs: 30000 },
  VALIDATION_ERROR:      { retryable: false, suggestedAction: 'reformulate' },
  UNAUTHORIZED:          { retryable: false, suggestedAction: 'authenticate' },
  FORBIDDEN:             { retryable: false, suggestedAction: 'abort' },
  NOT_FOUND:             { retryable: false, suggestedAction: 'abort' },
  PAYLOAD_TOO_LARGE:     { retryable: false, suggestedAction: 'reformulate' },
  SSRF_BLOCKED:          { retryable: false, suggestedAction: 'abort' },
};

/**
 * Build a gateway error response in NaaP envelope format.
 * Includes agent-friendly recovery metadata (retryable, suggestedAction).
 */
export function buildErrorResponse(
  code: string,
  message: string,
  statusCode: number,
  requestId: string | null,
  traceId: string | null,
  details?: unknown
): NextResponse {
  const recovery = ERROR_RECOVERY[code] || { retryable: false, suggestedAction: 'abort' };
  const body = {
    success: false,
    error: {
      code,
      message,
      retryable: recovery.retryable,
      suggestedAction: recovery.suggestedAction,
      ...(recovery.retryAfterMs ? { retryAfterMs: recovery.retryAfterMs } : {}),
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  const headers: Record<string, string> = {};
  if (requestId) headers['x-request-id'] = requestId;
  if (traceId) headers['x-trace-id'] = traceId;
  if (recovery.retryable && recovery.retryAfterMs) {
    headers['Retry-After'] = String(Math.ceil(recovery.retryAfterMs / 1000));
  }

  return NextResponse.json(body, { status: statusCode, headers });
}
