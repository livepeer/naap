import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    return NextResponse.json({ data: [] });
  } catch (err) {
    console.error('[auto-claim/claimable] Error:', err);
    return errors.internal('Failed to fetch claimable rewards');
  }
}
