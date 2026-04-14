import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getPriceChart } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const days = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)),
      365,
    );

    const points = await getPriceChart(days);
    return NextResponse.json({ data: { days, points } });
  } catch (err) {
    console.error('[prices/chart] Error:', err);
    return errors.internal('Failed to fetch price chart');
  }
}
