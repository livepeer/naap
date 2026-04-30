/**
 * AgentBook Invoice API — Vercel serverless catch-all route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PLUGIN_PORTS, DEFAULT_PORT } from '@/lib/plugin-ports';

const URL = process.env.AGENTBOOK_INVOICE_URL || `http://localhost:${PLUGIN_PORTS['agentbook-invoice'] || DEFAULT_PORT}`;

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const target = `${URL}/api/v1/agentbook-invoice/${path.join('/')}${request.nextUrl.search}`;
  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  let tenant = request.headers.get('x-tenant-id')
    || request.cookies.get('ab-tenant')?.value;
  if (!tenant) {
    const authToken = request.cookies.get('naap_auth_token')?.value;
    if (authToken) {
      try {
        const { validateSession } = await import('@/lib/api/auth');
        const user = await validateSession(authToken);
        if (user) tenant = user.id;
      } catch { /* use default */ }
    }
  }
  headers.set('x-tenant-id', tenant || 'default');

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try { body = await request.text(); } catch { /* no body */ }
    }
    const res = await fetch(target, { method: request.method, headers, body });
    const resBody = await res.text();
    return new NextResponse(resBody, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch {
    return NextResponse.json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'AgentBook Invoice service unavailable' } }, { status: 503 });
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
