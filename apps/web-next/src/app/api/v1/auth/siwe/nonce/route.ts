import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  const jwtIssuerUrl = process.env.JWT_ISSUER_URL || 'http://localhost:8082';

  try {
    const response = await fetch(`${jwtIssuerUrl}/auth/nonce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json().catch(() => ({ error: 'Failed to get nonce' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || 'Failed to reach jwt-issuer nonce endpoint' },
      { status: 502 }
    );
  }
}
