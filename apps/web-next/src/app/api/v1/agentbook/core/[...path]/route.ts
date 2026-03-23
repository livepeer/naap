/**
 * AgentBook Core API — Vercel serverless catch-all route.
 * Proxies to agentbook-core backend in dev, runs inline on Vercel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PLUGIN_PORTS, DEFAULT_PORT } from '@/lib/plugin-ports';

const CORE_URL = process.env.AGENTBOOK_CORE_URL || `http://localhost:${PLUGIN_PORTS['agentbook-core'] || DEFAULT_PORT}`;

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathString = path.join('/');
  const targetUrl = `${CORE_URL}/api/v1/agentbook-core/${pathString}${request.nextUrl.search}`;

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  const authHeader = request.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);

  const tenantId = request.headers.get('x-tenant-id');
  if (tenantId) headers.set('x-tenant-id', tenantId);

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try { body = await request.text(); } catch { /* no body */ }
    }

    const response = await fetch(targetUrl, { method: request.method, headers, body });
    const responseBody = await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'AgentBook Core service unavailable' } },
      { status: 503 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
