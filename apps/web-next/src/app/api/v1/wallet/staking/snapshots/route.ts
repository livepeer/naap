import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const address = request.nextUrl.searchParams.get('address');
    if (!address) return errors.badRequest('address is required');

    const limit = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '90', 10)),
      365,
    );

    const snapshots = await prisma.walletStakingSnapshot.findMany({
      where: { address: address.toLowerCase() },
      orderBy: { snapshotAt: 'desc' },
      take: limit,
    });

    const summary = snapshots.length > 0
      ? {
          latestStake: snapshots[0].stakedAmount,
          latestRewards: snapshots[0].pendingRewards,
          firstSnapshot: snapshots[snapshots.length - 1].snapshotAt,
          lastSnapshot: snapshots[0].snapshotAt,
          count: snapshots.length,
        }
      : null;

    return NextResponse.json({ data: { snapshots, summary } });
  } catch (err) {
    console.error('[staking/snapshots] Error:', err);
    return errors.internal('Failed to fetch staking snapshots');
  }
}
