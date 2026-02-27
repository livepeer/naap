/**
 * Service Gateway — Engine Route
 * ALL /api/v1/gw/:connector/:path*
 *
 * The core serverless function that proxies consumer requests to upstream
 * services. Implements the full pipeline:
 *
 *   Resolve → Authorize → Policy → Validate → Transform → Proxy → Respond → Log
 *
 * Supports: GET, POST, PUT, PATCH, DELETE
 * Auth: JWT (NaaP plugins) or API Key (external consumers)
 * Streaming: SSE passthrough for LLM-style endpoints
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveConfig } from '@/lib/gateway/resolve';
import { authorize, extractTeamContext, verifyConnectorAccess } from '@/lib/gateway/authorize';
import { buildUpstreamRequest } from '@/lib/gateway/transform';
import { proxyToUpstream, ProxyError } from '@/lib/gateway/proxy';
import { buildResponse, buildErrorResponse } from '@/lib/gateway/respond';
import { resolveSecrets } from '@/lib/gateway/secrets';
import { getAuthToken, getClientIP } from '@/lib/api/response';
import type { UsageData } from '@/lib/gateway/types';

type RouteContext = { params: Promise<{ connector: string; path: string[] }> };

async function handleRequest(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const startMs = Date.now();
  const { connector: slug, path: pathSegments } = await context.params;
  const consumerPath = '/' + pathSegments.join('/');
  const method = request.method;

  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const traceId = request.headers.get('x-trace-id') || requestId;

  // ── 1. Authorize Caller ──
  const auth = await authorize(request);
  if (!auth) {
    return buildErrorResponse(
      'UNAUTHORIZED',
      'Missing or invalid authentication. Provide a JWT or gateway API key.',
      401,
      requestId,
      traceId
    );
  }

  const teamId = auth.teamId;

  // ── 2. Resolve Connector + Endpoint Config ──
  const config = await resolveConfig(teamId, slug, method, consumerPath);
  if (!config) {
    return buildErrorResponse(
      'NOT_FOUND',
      `No published connector "${slug}" with ${method} ${consumerPath} found for your team.`,
      404,
      requestId,
      traceId
    );
  }

  // ── 3. Verify Team Isolation ──
  if (!verifyConnectorAccess(auth, config.connector.id, config.connector.teamId)) {
    return buildErrorResponse(
      'NOT_FOUND',
      `Connector not found.`,
      404,
      requestId,
      traceId
    );
  }

  // ── 4. Endpoint Access Check (API key scoping) ──
  if (auth.allowedEndpoints && auth.allowedEndpoints.length > 0) {
    if (!auth.allowedEndpoints.includes(config.endpoint.id) &&
        !auth.allowedEndpoints.includes(config.endpoint.name)) {
      return buildErrorResponse(
        'FORBIDDEN',
        'Your API key does not have access to this endpoint.',
        403,
        requestId,
        traceId
      );
    }
  }

  // ── 5. IP Allowlist Check ──
  if (auth.allowedIPs && auth.allowedIPs.length > 0) {
    const clientIP = getClientIP(request);
    if (!clientIP || !auth.allowedIPs.includes(clientIP)) {
      return buildErrorResponse(
        'FORBIDDEN',
        clientIP
          ? 'Request from this IP address is not allowed.'
          : 'Unable to determine client IP for allowlist check.',
        403,
        requestId,
        traceId
      );
    }
  }

  // ── 6. Read Consumer Body ──
  let consumerBody: string | null = null;
  let requestBytes = 0;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      consumerBody = await request.text();
      requestBytes = new TextEncoder().encode(consumerBody).length;
    } catch {
      // No body
    }
  }

  // ── 7. Request Size Check ──
  const maxRequestSize = config.endpoint.maxRequestSize || auth.maxRequestSize;
  if (maxRequestSize && requestBytes > maxRequestSize) {
    return buildErrorResponse(
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds maximum size of ${maxRequestSize} bytes.`,
      413,
      requestId,
      traceId
    );
  }

  // ── 8. Resolve Secrets ──
  const token = getAuthToken(request);
  const secrets = await resolveSecrets(teamId, config.connector.secretRefs, token);

  // ── 9. Transform Request ──
  const upstream = buildUpstreamRequest(request, config, secrets, consumerBody, consumerPath);

  // ── 10. Proxy to Upstream ──
  const timeout = config.endpoint.timeout || config.connector.defaultTimeout;

  let proxyResult;
  try {
    proxyResult = await proxyToUpstream(
      upstream,
      timeout,
      config.endpoint.retries,
      config.connector.allowedHosts
    );
  } catch (err) {
    const proxyError = err instanceof ProxyError ? err : new ProxyError('UPSTREAM_ERROR', String(err), 502);

    // Log error usage
    logUsage({
      teamId,
      connectorId: config.connector.id,
      endpointName: config.endpoint.name,
      apiKeyId: auth.apiKeyId || null,
      callerType: auth.callerType,
      callerId: auth.callerId,
      method,
      path: consumerPath,
      statusCode: proxyError.statusCode,
      latencyMs: Date.now() - startMs,
      upstreamLatencyMs: 0,
      requestBytes,
      responseBytes: 0,
      cached: false,
      error: proxyError.message,
      region: process.env.VERCEL_REGION || null,
    });

    return buildErrorResponse(
      proxyError.code,
      proxyError.message,
      proxyError.statusCode,
      requestId,
      traceId
    );
  }

  // ── 11. Build Response ──
  const response = await buildResponse(config, proxyResult, requestId, traceId);

  // ── 12. Log Usage (non-blocking via waitUntil) ──
  const responseBytes = parseInt(response.headers.get('content-length') || '0', 10);
  logUsage({
    teamId,
    connectorId: config.connector.id,
    endpointName: config.endpoint.name,
    apiKeyId: auth.apiKeyId || null,
    callerType: auth.callerType,
    callerId: auth.callerId,
    method,
    path: consumerPath,
    statusCode: proxyResult.response.status,
    latencyMs: Date.now() - startMs,
    upstreamLatencyMs: proxyResult.upstreamLatencyMs,
    requestBytes,
    responseBytes,
    cached: proxyResult.cached,
    error: null,
    region: process.env.VERCEL_REGION || null,
  });

  return response;
}

/**
 * Non-blocking usage logging. In production this would use waitUntil().
 * For now, fire-and-forget the DB write.
 */
function logUsage(data: UsageData): void {
  // Dynamically import to avoid loading Prisma on every request path
  import('@/lib/db').then(({ prisma }) => {
    prisma.gatewayUsageRecord
      .create({
        data: {
          teamId: data.teamId,
          connectorId: data.connectorId,
          endpointName: data.endpointName,
          apiKeyId: data.apiKeyId,
          callerType: data.callerType,
          callerId: data.callerId,
          method: data.method,
          path: data.path,
          statusCode: data.statusCode,
          latencyMs: data.latencyMs,
          upstreamLatencyMs: data.upstreamLatencyMs,
          requestBytes: data.requestBytes,
          responseBytes: data.responseBytes,
          cached: data.cached,
          error: data.error,
          region: data.region,
        },
      })
      .catch((err) => {
        console.error('[gateway] usage log failed:', err);
      });
  }).catch(() => {});
}

// ── HTTP Method Handlers ──

export async function GET(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleRequest(request, context);
}
