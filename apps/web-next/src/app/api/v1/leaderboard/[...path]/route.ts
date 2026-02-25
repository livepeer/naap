import { NextRequest, NextResponse } from 'next/server';

const LEADERBOARD_API_URL = process.env.LEADERBOARD_API_URL || 'https://leaderboard-api.livepeer.cloud';

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const pathString = path.join('/');
  const targetUrl = `${LEADERBOARD_API_URL}/api/${pathString}${request.nextUrl.search}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    console.error('leaderboard proxy error:', err);
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Leaderboard API is unavailable',
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
