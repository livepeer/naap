/**
 * Proxy route for base-svc (off-Vercel long-running service)
 * GET/POST/PUT/PATCH/DELETE /api/v1/base/*
 *
 * Proxies requests to the base-svc backend service with:
 * - Auth token propagation (JWT)
 * - CSRF token forwarding
 * - Observability headers (request-id, trace-id)
 * - Team context forwarding
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';

const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathString = path.join('/');
  const targetUrl = `${BASE_SVC_URL}/api/${pathString}${request.nextUrl.search}`;

  const token = getAuthToken(request);

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

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

  // Forward team context
  const teamId = request.headers.get('x-team-id');
  if (teamId) {
    headers.set('x-team-id', teamId);
  }

  // Forward CSRF token
  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  // Forward IP headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    headers.set('x-real-ip', realIp);
  }

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.text();
      } catch {
        // No body
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseBody = await response.text();

    const responseHeaders = new Headers({
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    });

    // Propagate observability headers back
    if (requestId) {
      responseHeaders.set('x-request-id', requestId);
    }
    if (traceId) {
      responseHeaders.set('x-trace-id', traceId);
    }

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error('base-svc proxy error:', err);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'base-svc is unavailable',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}
