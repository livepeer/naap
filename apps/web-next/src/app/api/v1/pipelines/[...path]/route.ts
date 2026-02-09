/**
 * Proxy route for pipeline-gateway (off-Vercel long-running service)
 * GET/POST/PUT/PATCH/DELETE /api/v1/pipelines/*
 *
 * Proxies requests to the pipeline-gateway backend with:
 * - Auth token propagation (JWT)
 * - Observability headers (request-id, trace-id)
 * - Team context forwarding
 *
 * pipeline-gateway handles: AI pipelines, live video, BYOC
 * (Phase 5 implementation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';

const PIPELINE_GATEWAY_URL = process.env.PIPELINE_GATEWAY_URL || 'http://localhost:4020';

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathString = path.join('/');
  const targetUrl = `${PIPELINE_GATEWAY_URL}/api/v1/pipelines/${pathString}${request.nextUrl.search}`;

  const token = getAuthToken(request);

  const headers = new Headers();
  const contentType = request.headers.get('Content-Type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

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

  // Forward IP headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }

  try {
    let body: BodyInit | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // For pipelines, body may be multipart/form-data or JSON
      // Pass the raw body to preserve content type boundaries
      try {
        if (contentType?.includes('multipart/form-data')) {
          body = await request.arrayBuffer();
        } else {
          body = await request.text();
        }
      } catch {
        // No body
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    // For SSE streaming responses, pipe through directly
    const responseContentType = response.headers.get('Content-Type') || '';
    if (responseContentType.includes('text/event-stream')) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...(requestId ? { 'x-request-id': requestId } : {}),
          ...(traceId ? { 'x-trace-id': traceId } : {}),
        },
      });
    }

    const responseBody = await response.text();

    const responseHeaders = new Headers({
      'Content-Type': responseContentType || 'application/json',
    });

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
    console.error('pipeline-gateway proxy error:', err);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'pipeline-gateway is unavailable',
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
