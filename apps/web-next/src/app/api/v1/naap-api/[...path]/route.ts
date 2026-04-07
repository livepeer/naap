import { NextRequest, NextResponse } from 'next/server';

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';

function parseProxyTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw ?? 60000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

const NAAP_API_PROXY_TIMEOUT_MS = parseProxyTimeoutMs(process.env.NAAP_API_PROXY_TIMEOUT_MS);

const ENDPOINT_TTL_SECONDS: Record<string, number> = {
  'pipelines': 60 * 60,        // 1 hour
  'gpu/metrics': 60 * 60,      // 1 hour
};

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;

  if (path.some(segment => segment.includes('..') || segment.includes(':'))) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid path' } },
      { status: 400 }
    );
  }

  const pathString = path.join('/');
  const targetUrl = `${naapApiUpstreamUrl(pathString)}${request.nextUrl.search}`;
  const ttl = ENDPOINT_TTL_SECONDS[pathString] ?? 5 * 60;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      next: { revalidate: ttl },
      signal: AbortSignal.timeout(NAAP_API_PROXY_TIMEOUT_MS),
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    console.error('NAAP API proxy error:', err);
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'NAAP API is unavailable',
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
