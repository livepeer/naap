import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function POST(request: NextRequest) {
  // On Vercel, this is triggered by cron — validate CRON_SECRET
  if (process.env.VERCEL) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  return proxyToBackend(request, '/health/check-all', { skipAuth: true });
}
