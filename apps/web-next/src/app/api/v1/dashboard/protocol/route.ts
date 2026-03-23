import { NextResponse } from 'next/server';
import { resolveProtocol } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await resolveProtocol();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/protocol] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Protocol data is unavailable' } },
      { status: 503 }
    );
  }
}
