/**
 * Network history endpoint (S21)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '90', 10);
    const startDate = request.nextUrl.searchParams.get('startDate');
    const where = startDate ? { snapshotAt: { gte: new Date(startDate) } } : {};

    const snapshots = await prisma.walletNetworkSnapshot.findMany({
      where,
      orderBy: { round: 'asc' },
      take: limit,
    });

    const dataPoints = snapshots.map(s => ({
      round: s.round,
      totalBonded: s.totalBonded,
      participationRate: s.participationRate,
      inflation: s.inflation,
      activeOrchestrators: s.activeOrchestrators,
      avgRewardCut: s.avgRewardCut,
      avgFeeShare: s.avgFeeShare,
      snapshotAt: s.snapshotAt.toISOString(),
    }));

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    return success({
      dataPoints,
      summary: {
        bondedChange: first && last ? (BigInt(last.totalBonded || '0') - BigInt(first.totalBonded || '0')).toString() : '0',
        participationChange: first && last ? parseFloat((last.participationRate - first.participationRate).toFixed(2)) : 0,
        orchestratorCountChange: first && last ? last.activeOrchestrators - first.activeOrchestrators : 0,
        periodStart: first?.snapshotAt.toISOString() || new Date().toISOString(),
        periodEnd: last?.snapshotAt.toISOString() || new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Network history error:', err);
    return errors.internal('Failed to fetch network history');
  }
}
