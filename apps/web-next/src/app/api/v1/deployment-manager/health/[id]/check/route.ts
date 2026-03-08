import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';

const PLUGIN_BACKEND = process.env.DEPLOYMENT_MANAGER_URL || 'http://localhost:4117';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const user = await validateSession(token);
    if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });

    const { id } = await params;
    const res = await fetch(`${PLUGIN_BACKEND}/api/v1/deployment-manager/health/${id}/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
