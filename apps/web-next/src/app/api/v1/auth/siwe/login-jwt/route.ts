import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const jwtIssuerUrl = process.env.JWT_ISSUER_URL || 'http://localhost:8082';

  try {
    const body = await request.json();
    const response = await fetch(`${jwtIssuerUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({ error: 'Authentication failed' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || 'Failed to reach jwt-issuer login endpoint' },
      { status: 502 }
    );
  }
}
