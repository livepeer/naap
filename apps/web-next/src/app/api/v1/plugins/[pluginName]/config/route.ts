/**
 * Plugin Config API - Proxy to base-svc
 * GET  /api/v1/plugins/:pluginName/config - Get user's personal plugin config
 * PUT  /api/v1/plugins/:pluginName/config - Save user's personal plugin config
 *
 * Proxies to base-svc so plugins always use same-origin (no CORS, no port confusion).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';

const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ pluginName: string }> }
): Promise<NextResponse> {
  const { pluginName } = await params;
  const token = getAuthToken(request);

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Forward CSRF, observability, and team context headers
  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);
  const traceId = request.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);
  const teamId = request.headers.get('x-team-id');
  if (teamId) headers.set('x-team-id', teamId);

  const targetUrl = `${BASE_SVC_URL}/api/v1/plugins/${pluginName}/config${request.nextUrl.search}`;

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text();
    }
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });
    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err) {
    console.error('[plugin config proxy]', err);
    return NextResponse.json(
      { error: { message: 'base-svc is unavailable' } },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ pluginName: string }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ pluginName: string }> }
) {
  return handleRequest(request, context);
}
