/**
 * Network overview endpoint — Dune-style dashboard data.
 * Dedicated Next.js route handler (replaces proxy to wallet backend on Vercel).
 */

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
      parseInt(request.nextUrl.searchParams.get('days') || '90', 10),
      365,
    );
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [snapshots, dbOrchestrators, latestSnapshot] = await Promise.all([
      prisma.walletNetworkSnapshot.findMany({
        where: { snapshotAt: { gte: cutoff } },
        orderBy: { round: 'asc' },
      }),
      prisma.walletOrchestrator.findMany({
        where: { isActive: true },
        orderBy: { totalStake: 'desc' },
        take: 20,
        select: {
          address: true,
          name: true,
          totalStake: true,
          rewardCut: true,
          feeShare: true,
          totalVolumeETH: true,
          thirtyDayVolumeETH: true,
          delegatorCount: true,
          rewardCallRatio: true,
          isActive: true,
          capabilities: { select: { category: true } },
        },
      }),
      prisma.walletNetworkSnapshot.findFirst({
        orderBy: { round: 'desc' },
      }),
    ]);

    const current = {
      totalBonded: latestSnapshot?.totalBonded || '0',
      totalSupply: latestSnapshot?.totalSupply || '0',
      participationRate: latestSnapshot?.participationRate || 0,
      activeOrchestrators: latestSnapshot?.activeOrchestrators || 0,
      delegatorsCount: latestSnapshot?.delegatorsCount || 0,
      totalVolumeETH: latestSnapshot?.totalVolumeETH || '0',
      totalVolumeUSD: latestSnapshot?.totalVolumeUSD || '0',
      inflation: latestSnapshot?.inflation || '0',
    };

    const topOrchestrators = dbOrchestrators.map((o) => ({
      address: o.address,
      name: o.name,
      totalStake: o.totalStake,
      rewardCut: o.rewardCut,
      feeShare: o.feeShare,
      totalVolumeETH: o.totalVolumeETH,
      thirtyDayVolumeETH: o.thirtyDayVolumeETH,
      delegatorCount: o.delegatorCount,
      rewardCallRatio: o.rewardCallRatio,
      isActive: o.isActive,
      categories: [...new Set(o.capabilities.map((c) => c.category))],
    }));

    return NextResponse.json({
      data: {
        snapshots,
        topOrchestrators,
        synced: dbOrchestrators.length > 0,
        prices: { lptUsd: 0, ethUsd: 0, lptChange24h: 0 },
        current,
      },
    });
  } catch (err) {
    console.error('[networkOverview] Error:', err);
    return errors.internal('Failed to fetch network overview');
  }
}
