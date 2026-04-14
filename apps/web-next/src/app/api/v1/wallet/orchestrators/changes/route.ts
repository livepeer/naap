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

    const days = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)),
      90,
    );

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const histories = await prisma.walletOrchestratorRoundHistory.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { round: 'desc' },
      take: 500,
    });

    const changesByAddress = new Map<string, any[]>();
    for (const h of histories) {
      if (!changesByAddress.has(h.address)) changesByAddress.set(h.address, []);
      changesByAddress.get(h.address)!.push(h);
    }

    const changes: any[] = [];
    for (const [address, rounds] of changesByAddress) {
      for (let i = 0; i < rounds.length - 1; i++) {
        const curr = rounds[i];
        const prev = rounds[i + 1];
        if (curr.rewardCut !== prev.rewardCut || curr.feeShare !== prev.feeShare) {
          changes.push({
            address,
            round: curr.round,
            timestamp: curr.createdAt,
            rewardCut: { from: prev.rewardCut, to: curr.rewardCut },
            feeShare: { from: prev.feeShare, to: curr.feeShare },
          });
        }
      }
    }

    changes.sort((a, b) => b.round - a.round);

    return NextResponse.json({ data: changes });
  } catch (err) {
    console.error('[orchestrators/changes] Error:', err);
    return errors.internal('Failed to fetch orchestrator changes');
  }
}
