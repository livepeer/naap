import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getWinningTicketEvents } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const limit = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10)),
      200,
    );

    let events: any[] = [];
    try {
      events = await getWinningTicketEvents(limit);
    } catch {
      // fallback to empty on subgraph failure
    }

    return NextResponse.json({ data: events });
  } catch (err) {
    console.error('[network/tickets] Error:', err);
    return errors.internal('Failed to fetch ticket events');
  }
}
