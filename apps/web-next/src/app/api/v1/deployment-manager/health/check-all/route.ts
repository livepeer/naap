import { NextRequest, NextResponse } from 'next/server';

const PLUGIN_BACKEND = process.env.DEPLOYMENT_MANAGER_URL || 'http://localhost:4117';

export async function POST(request: NextRequest) {
  try {
    // On Vercel, this is triggered by cron — validate CRON_SECRET
    if (process.env.VERCEL) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const res = await fetch(`${PLUGIN_BACKEND}/api/v1/deployment-manager/health/check-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
