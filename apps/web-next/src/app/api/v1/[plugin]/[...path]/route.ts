/**
 * Catch-all route for plugin APIs
 * GET/POST/PUT/PATCH/DELETE /api/v1/:plugin/*
 *
 * This route proxies requests to plugin backend services.
 * In production, these would be handled by the plugin's serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';

// Plugin service URLs (in development, these point to local services)
const PLUGIN_SERVICES: Record<string, string> = {
  'gateway': process.env.GATEWAY_MANAGER_URL || 'http://localhost:4001',
  'gateway-manager': process.env.GATEWAY_MANAGER_URL || 'http://localhost:4001',
  'orchestrator': process.env.ORCHESTRATOR_MANAGER_URL || 'http://localhost:4002',
  'orchestrator-manager': process.env.ORCHESTRATOR_MANAGER_URL || 'http://localhost:4002',
  'capacity': process.env.CAPACITY_PLANNER_URL || 'http://localhost:4003',
  'capacity-planner': process.env.CAPACITY_PLANNER_URL || 'http://localhost:4003',
  'analytics': process.env.NETWORK_ANALYTICS_URL || 'http://localhost:4004',
  'network-analytics': process.env.NETWORK_ANALYTICS_URL || 'http://localhost:4004',
  'marketplace': process.env.MARKETPLACE_URL || 'http://localhost:4005',
  'community': process.env.COMMUNITY_URL || 'http://localhost:4006',
  'wallet': process.env.WALLET_URL || 'http://localhost:4007',
  'my-wallet': process.env.WALLET_URL || 'http://localhost:4007',
  'dashboard': process.env.DASHBOARD_URL || 'http://localhost:4008',
  'my-dashboard': process.env.DASHBOARD_URL || 'http://localhost:4008',
  'daydream': process.env.DAYDREAM_VIDEO_URL || 'http://localhost:4010',
  'daydream-video': process.env.DAYDREAM_VIDEO_URL || 'http://localhost:4010',
  'developer-api': process.env.DEVELOPER_API_URL || 'http://localhost:4011',
  'plugin-publisher': process.env.PLUGIN_PUBLISHER_URL || 'http://localhost:4012',
};

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
  // For GET requests, return empty data so the UI degrades gracefully.
  // For mutations, return a clear error.
  const isVercel = process.env.VERCEL === '1';
  if (isVercel && serviceUrl.includes('localhost')) {
    if (request.method === 'GET') {
      // Return empty data — the UI should handle empty arrays/objects gracefully
      console.warn(
        `[proxy] Vercel: returning empty data for GET /api/v1/${plugin}/${path.join('/')}. ` +
        `Add a dedicated Next.js route handler to serve real data.`
      );
      return NextResponse.json(
        { posts: [], entries: [], tags: [], items: [], total: 0, data: null },
        {
          status: 200,
          headers: { 'X-Fallback': 'true' },
        }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Plugin service "${plugin}" is not available in this environment. ` +
            `This write endpoint needs a dedicated Next.js route handler.`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
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
