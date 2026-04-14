import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const isAdmin = user.roles?.includes('admin');
    if (!isAdmin) return errors.forbidden('Admin access required');

    return NextResponse.json({
      success: true,
      message: 'Monthly snapshot trigger not available in this environment',
    });
  } catch (err) {
    console.error('[snapshots/monthly] Error:', err);
    return errors.internal('Failed to trigger monthly snapshot');
  }
}
