import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getStakingHistory } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const address = request.nextUrl.searchParams.get('address');
    if (!address) return errors.badRequest('address is required');

    let events: any[] = [];
    try {
      events = await getStakingHistory(address.toLowerCase());
    } catch {
      // fallback to empty on subgraph failure
    }

    return NextResponse.json({ data: { events, total: events.length } });
  } catch (err) {
    console.error('[staking/history] Error:', err);
    return errors.internal('Failed to fetch staking history');
  }
}
