import { NextRequest, NextResponse } from 'next/server';

/**
 * Dedicated proxy for lightning plugin to handle streaming POST/GET
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, params);
}

async function handleRequest(
  request: NextRequest,
  paramsPromise: Promise<{ path: string[] }>
) {
  const { path } = await paramsPromise;
  const pathString = path.join('/');
  
  // Lightning backend is at port 4112
  // healthz is mounted at root by the SDK, all other routes live under /api/v1
  const prefix = pathString === 'healthz' ? '' : '/api/v1';
  const targetUrl = `http://localhost:4112${prefix}/${pathString}${request.nextUrl.search}`;
  
  console.log(`[lightning-proxy] Proxying ${request.method} to ${targetUrl}`);

  const headers = new Headers(request.headers);
  headers.delete('host');
  // Prevent the backend from compressing binary streams — Node.js fetch
  // auto-decompresses but keeps the Content-Encoding header, which would
  // cause the browser to double-decompress and corrupt the data.
  headers.delete('accept-encoding');

  try {
    const contentLength = request.headers.get('content-length');
    const hasBody =
      request.method === 'POST' &&
      request.body !== null &&
      contentLength !== '0' &&
      contentLength !== null;

    const fetchInit: Record<string, unknown> = {
      method: request.method,
      headers,
    };

    if (hasBody) {
      fetchInit.body = request.body;
      fetchInit.duplex = 'half';
    }

    const response = await fetch(targetUrl, fetchInit as RequestInit);

    console.log(`[lightning-proxy] Backend returned ${response.status} for ${pathString}`);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error(`[lightning-proxy] Error:`, err);
    return NextResponse.json({ error: 'Proxy failed', details: err.message }, { status: 502 });
  }
}
