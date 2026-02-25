/**
 * Service Gateway — Engine Route
 * ALL /api/v1/gw/:connector/:path*
 *
 * The core serverless function that proxies consumer requests to upstream
 * services. Implements the full pipeline:
 *
 *   Authorize → Resolve → Access → IP → Body → Size → Policy → Validate →
 *   Cache → Secrets → Transform → Proxy → Respond → Log
 *
 * Supports: GET, POST, PUT, PATCH, DELETE
 * Auth: JWT (NaaP plugins) or API Key (external consumers)
 * Streaming: SSE passthrough for LLM-style endpoints
 */

import { NextRequest } from 'next/server';
import { resolveConfig } from '@/lib/gateway/resolve';
import { authorize, verifyConnectorAccess } from '@/lib/gateway/authorize';
import { enforcePolicy } from '@/lib/gateway/policy';
import { validateRequest } from '@/lib/gateway/validate';
import { buildUpstreamRequest } from '@/lib/gateway/transform';
import { proxyToUpstream, ProxyError } from '@/lib/gateway/proxy';
import { buildResponse, buildErrorResponse } from '@/lib/gateway/respond';
import { resolveSecrets } from '@/lib/gateway/secrets';
import { getCachedResponse, setCachedResponse, buildCacheKey } from '@/lib/gateway/cache';
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

  const scopeId = auth.teamId;

  // ── 2. Resolve Connector + Endpoint Config ──
  const config = await resolveConfig(scopeId, slug, method, consumerPath);
  if (!config) {
    return buildErrorResponse(
      'NOT_FOUND',
      `No published connector "${slug}" with ${method} ${consumerPath} found for your scope.`,
      404,
      requestId,
      traceId
    );
  }

  // ── 3. Verify Ownership Isolation ──
  if (!verifyConnectorAccess(auth, config.connector.id, config.connector.teamId, config.connector.ownerUserId, config.connector.visibility)) {
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
    if (clientIP && !auth.allowedIPs.includes(clientIP)) {
      return buildErrorResponse(
        'FORBIDDEN',
        'Request from this IP address is not allowed.',
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

  // ── 8. Enforce Policy (rate limits, quotas) ──
  const policy = await enforcePolicy(auth, config.endpoint, requestBytes);
  if (!policy.allowed) {
    const errorResponse = buildErrorResponse(
      'RATE_LIMITED',
      policy.reason || 'Request blocked by policy',
      policy.statusCode || 429,
      requestId,
      traceId
    );
    if (policy.headers) {
      for (const [k, v] of Object.entries(policy.headers)) {
        errorResponse.headers.set(k, v);
      }
    }
    return errorResponse;
  }

  // ── 9. Validate Request (headers, body pattern, schema) ──
  const validation = validateRequest(request, config.endpoint, consumerBody);
  if (!validation.valid) {
    return buildErrorResponse(
      'VALIDATION_ERROR',
      validation.error || 'Request validation failed',
      400,
      requestId,
      traceId
    );
  }

  // ── 10. Response Cache Check (GET only) ──
  const cacheKey = buildCacheKey(scopeId, slug, method, consumerPath, consumerBody);
  const cacheTtl = config.endpoint.cacheTtl;
  if (method === 'GET' && cacheTtl && cacheTtl > 0) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Gateway-Cache', 'HIT');
      if (requestId) headers.set('x-request-id', requestId);
      if (traceId) headers.set('x-trace-id', traceId);
      if (policy.headers) {
        for (const [k, v] of Object.entries(policy.headers)) {
          headers.set(k, v);
        }
      }

      logUsage({
        teamId: scopeId,
        ownerScope: scopeId,
        connectorId: config.connector.id,
        endpointName: config.endpoint.name,
        apiKeyId: auth.apiKeyId || null,
        callerType: auth.callerType,
        callerId: auth.callerId,
        method,
        path: consumerPath,
        statusCode: cached.status,
        latencyMs: Date.now() - startMs,
        upstreamLatencyMs: 0,
        requestBytes,
        responseBytes: cached.body.byteLength,
        cached: true,
        error: null,
        region: process.env.VERCEL_REGION || null,
      });

      return new Response(cached.body, { status: cached.status, headers });
    }
  }

  // ── 11. Resolve Secrets ──
  // For public connectors, resolve upstream secrets from the connector owner's
  // scope (the admin who configured the key), not the caller's scope.
  const token = getAuthToken(request);
  let secretScopeId = scopeId;
  if (config.connector.visibility === 'public' && config.connector.ownerUserId) {
    secretScopeId = `personal:${config.connector.ownerUserId}`;
  }
  const secrets = await resolveSecrets(secretScopeId, config.connector.secretRefs, token);

  // ── 12. Transform Request ──
  const upstream = buildUpstreamRequest(request, config, secrets, consumerBody, consumerPath);

  // ── 13. Proxy to Upstream ──
  const timeout = config.endpoint.timeout || config.connector.defaultTimeout;

  let proxyResult;
  try {
    proxyResult = await proxyToUpstream(
      upstream,
      timeout,
      config.endpoint.retries,
      config.connector.allowedHosts,
      config.connector.streamingEnabled
    );
  } catch (err) {
    const proxyError = err instanceof ProxyError ? err : new ProxyError('UPSTREAM_ERROR', String(err), 502);

    logUsage({
      teamId: scopeId,
      ownerScope: scopeId,
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

  // ── 14. Build Response ──
  const response = await buildResponse(config, proxyResult, requestId, traceId);

  // Merge rate limit headers into successful response
  if (policy.headers) {
    for (const [k, v] of Object.entries(policy.headers)) {
      response.headers.set(k, v);
    }
  }

  // ── 15. Cache Store (GET + 2xx + cacheTtl) ──
  if (method === 'GET' && cacheTtl && cacheTtl > 0 && proxyResult.response.status >= 200 && proxyResult.response.status < 300) {
    const cloned = response.clone();
    cloned.arrayBuffer().then((body) => {
      const headers: Record<string, string> = {};
      cloned.headers.forEach((v, k) => { headers[k] = v; });
      setCachedResponse(cacheKey, { body, status: cloned.status, headers }, cacheTtl);
    }).catch(() => {});
  }

  // ── 16. Log Usage (non-blocking) ──
  const responseBytes = parseInt(response.headers.get('content-length') || '0', 10);
  logUsage({
    teamId: scopeId,
    ownerScope: scopeId,
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
