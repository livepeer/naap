/**
 * Network overview endpoint — Dune-style dashboard data.
 * Dedicated Next.js route handler (replaces proxy to wallet backend on Vercel).
 * Uses DB snapshots when available, falls back to live subgraph + public exchange spot prices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getPrices, getProtocol, getOrchestrators } from '@/lib/wallet/subgraph';

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

    const [snapshots, dbOrchestrators, prices, latestSnapshot, protocol, liveOrchestrators] = await Promise.all([
      prisma.walletNetworkSnapshot.findMany({
        where: { snapshotAt: { gte: cutoff } },
        orderBy: { round: 'asc' },
      }),
      prisma.walletOrchestrator.findMany({
        where: { isActive: true },
        orderBy: { totalStake: 'desc' },
        take: 200,
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
      getPrices().catch(() => ({ lptUsd: 0, ethUsd: 0, lptChange24h: 0 })),
      prisma.walletNetworkSnapshot.findFirst({
        orderBy: { round: 'desc' },
      }),
      getProtocol().catch(() => null),
      getOrchestrators().catch(() => [] as any[]),
    ]);

    const current = {
      totalBonded: protocol?.totalActiveStake || latestSnapshot?.totalBonded || '0',
      totalSupply: protocol?.totalSupply || latestSnapshot?.totalSupply || '0',
      participationRate: protocol?.participationRate || latestSnapshot?.participationRate || 0,
      activeOrchestrators: protocol?.activeTranscoderCount || latestSnapshot?.activeOrchestrators || 0,
      delegatorsCount: protocol?.delegatorsCount || latestSnapshot?.delegatorsCount || 0,
      totalVolumeETH: protocol?.totalVolumeETH || latestSnapshot?.totalVolumeETH || '0',
      totalVolumeUSD: protocol?.totalVolumeUSD || latestSnapshot?.totalVolumeUSD || '0',
      inflation: protocol?.inflation || latestSnapshot?.inflation || '0',
    };

    const dbMap = new Map(
      dbOrchestrators.map((o) => [o.address.toLowerCase(), o]),
    );

    let synced = dbOrchestrators.length > 0;
    let topOrchestrators: any[];

    if (liveOrchestrators.length > 0) {
      topOrchestrators = liveOrchestrators.slice(0, 20).map((live: any) => {
        const db = dbMap.get(live.address.toLowerCase());
        return {
          address: live.address,
          name: db?.name || live.name || null,
          totalStake: live.totalStake || '0',
          rewardCut: live.rewardCut ?? 0,
          feeShare: live.feeShare ?? 0,
          totalVolumeETH: live.totalVolumeETH || '0',
          thirtyDayVolumeETH: live.thirtyDayVolumeETH || '0',
          delegatorCount: live.delegatorCount || db?.delegatorCount || 0,
          rewardCallRatio: live.rewardCallRatio || db?.rewardCallRatio || 0,
          isActive: true,
          categories: [...new Set((db?.capabilities || []).map((c: any) => c.category))],
        };
      });
    } else {
      topOrchestrators = dbOrchestrators.map((o) => ({
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
    }

    return NextResponse.json({
      data: {
        snapshots,
        topOrchestrators,
        synced,
        prices: {
          lptUsd: prices.lptUsd,
          ethUsd: prices.ethUsd,
          lptChange24h: prices.lptChange24h,
        },
        current,
      },
    });
  } catch (err) {
    console.error('[networkOverview] Error:', err);
    return errors.internal('Failed to fetch network overview');
  }
}
