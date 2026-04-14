import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { address } = await params;
    if (!address) return errors.badRequest('address is required');

    return NextResponse.json({
      data: {
        address: address.toLowerCase(),
        votes: [],
      },
    });
  } catch (err) {
    console.error('[governance/orchestrator] Error:', err);
    return errors.internal('Failed to fetch orchestrator governance data');
  }
}
