import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    return NextResponse.json(
      {
        data: {
          message:
            'Multi-orchestrator simulation not available in this environment',
        },
      },
      { status: 501 },
    );
  } catch (err) {
    console.error('[simulator/multi-orchestrator] Error:', err);
    return errors.internal('Failed to run simulation');
  }
}
