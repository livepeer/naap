/**
 * Catch-all route for plugin APIs
 * GET/POST/PUT/PATCH/DELETE /api/v1/:plugin/*
 *
 * This route proxies requests to plugin backend services.
 * In production, these would be handled by the plugin's serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';
import { PLUGIN_PORTS, DEFAULT_PORT } from '@naap/plugin-sdk';

// ─── Plugin service URL map ─────────────────────────────────────────────────
// Ports come from PLUGIN_PORTS (which mirrors plugin.json devPort values).
// Env-var overrides allow production deployments to point at real hosts.
// ─────────────────────────────────────────────────────────────────────────────

/** Mapping from plugin kebab-name to its env-var override key. */
const PLUGIN_ENV_MAP: Record<string, string> = {
  'gateway-manager': 'GATEWAY_MANAGER_URL',
  'orchestrator-manager': 'ORCHESTRATOR_MANAGER_URL',
  'capacity-planner': 'CAPACITY_PLANNER_URL',
  'network-analytics': 'NETWORK_ANALYTICS_URL',
  'marketplace': 'MARKETPLACE_URL',
  'community': 'COMMUNITY_URL',
  'my-wallet': 'WALLET_URL',
  'my-dashboard': 'DASHBOARD_URL',
  'daydream-video': 'DAYDREAM_VIDEO_URL',
  'developer-api': 'DEVELOPER_API_URL',
  'plugin-publisher': 'PLUGIN_PUBLISHER_URL',
};

/** Short aliases so both `/api/v1/wallet/...` and `/api/v1/my-wallet/...` resolve. */
const SHORT_ALIASES: Record<string, string> = {
  'gateway': 'gateway-manager',
  'orchestrator': 'orchestrator-manager',
  'capacity': 'capacity-planner',
  'analytics': 'network-analytics',
  'wallet': 'my-wallet',
  'dashboard': 'my-dashboard',
  'daydream': 'daydream-video',
};

function buildPluginServices(): Record<string, string> {
  const services: Record<string, string> = {};

  for (const [name, envKey] of Object.entries(PLUGIN_ENV_MAP)) {
    const port = (PLUGIN_PORTS as Record<string, number>)[name] ?? DEFAULT_PORT;
    services[name] = process.env[envKey] || `http://localhost:${port}`;
  }

  // Register short aliases pointing to the same resolved URL
  for (const [alias, canonical] of Object.entries(SHORT_ALIASES)) {
    if (services[canonical]) {
      services[alias] = services[canonical];
    }
  }

  return services;
}

const PLUGIN_SERVICES = buildPluginServices();

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string; path: string[] }> }
): Promise<NextResponse> {
  const { plugin, path } = await params;

  // Check if plugin is known
  const serviceUrl = PLUGIN_SERVICES[plugin];

  if (!serviceUrl) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plugin ${plugin} not found`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 404 }
    );
  }

  // On Vercel (production), localhost services are not available.
  // Every plugin endpoint should have a dedicated Next.js route handler.
  // If a request reaches this catch-all, it means the route is missing.
  const isVercel = process.env.VERCEL === '1';
  if (isVercel && serviceUrl.includes('localhost')) {
    console.warn(
      `[proxy] Vercel: unhandled route /api/v1/${plugin}/${path.join('/')} (${request.method}). ` +
      `Add a dedicated Next.js route handler for this endpoint.`
    );
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `Endpoint /api/v1/${plugin}/${path.join('/')} is not yet available in this environment. ` +
            `A dedicated Next.js route handler is needed.`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 501 }
    );
  }

  // Get auth token if present
  const token = getAuthToken(request);

  // Build the proxy URL
  const pathString = path.join('/');
  const targetUrl = `${serviceUrl}/api/v1/${pathString}${request.nextUrl.search}`;

  // Build headers for the proxy request
  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  // Forward auth token
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Forward observability headers
  const requestId = request.headers.get('x-request-id');
  if (requestId) {
    headers.set('x-request-id', requestId);
  }

  const traceId = request.headers.get('x-trace-id');
  if (traceId) {
    headers.set('x-trace-id', traceId);
  }

  // Forward other relevant headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    headers.set('x-real-ip', realIp);
  }

  // Forward team context if present
  const teamId = request.headers.get('x-team-id');
  if (teamId) {
    headers.set('x-team-id', teamId);
  }

  // Forward CSRF token
  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  try {
    // Get request body if present
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.text();
      } catch {
        // No body
      }
    }

    // Proxy the request
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    // Forward the response
    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    };
    if (requestId) responseHeaders['x-request-id'] = requestId;
    if (traceId) responseHeaders['x-trace-id'] = traceId;

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Proxy error for ${plugin}:`, err);

    // Return a service unavailable error if the backend is down
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Plugin service ${plugin} is unavailable`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}
