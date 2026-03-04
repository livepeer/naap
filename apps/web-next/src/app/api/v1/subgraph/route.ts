import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

function readEnvVar(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    const value = raw?.trim();
    if (value) return value;
  }
  return undefined;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = readEnvVar('SUBGRAPH_API_KEY');
  const subgraphId = readEnvVar('SUBGRAPH_ID') || DEFAULT_SUBGRAPH_ID;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'Subgraph proxy is unavailable (set SUBGRAPH_API_KEY in apps/web-next/.env.local and restart Next.js)',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }

  const targetUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;

  try {
    const body = await request.text();
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err) {
    console.error('subgraph proxy error:', err);
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Subgraph API is unavailable',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}
