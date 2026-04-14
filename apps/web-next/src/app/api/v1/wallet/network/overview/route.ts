/**
 * Network overview endpoint — Dune-style dashboard data.
 * Dedicated Next.js route handler (replaces proxy to wallet backend on Vercel).
 * Uses DB snapshots when available, falls back to live subgraph + CoinGecko.
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

    const [snapshots, dbOrchestrators, prices, latestSnapshot, protocol] = await Promise.all([
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
      getPrices().catch(() => ({ lptUsd: 0, ethUsd: 0, lptChange24h: 0 })),
      prisma.walletNetworkSnapshot.findFirst({
        orderBy: { round: 'desc' },
      }),
      getProtocol().catch(() => null),
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

    let synced = dbOrchestrators.length > 0;
    let orchestratorData = dbOrchestrators as typeof dbOrchestrators;

    if (dbOrchestrators.length === 0) {
      try {
        const liveOrchs = await getOrchestrators();
        orchestratorData = liveOrchs.slice(0, 20).map((o: any) => ({
          address: o.address,
          name: o.name || null,
          totalStake: o.totalStake || '0',
          rewardCut: o.rewardCut ?? 0,
          feeShare: o.feeShare ?? 0,
          totalVolumeETH: o.totalVolumeETH || '0',
          thirtyDayVolumeETH: o.thirtyDayVolumeETH || '0',
          delegatorCount: o.delegatorCount || 0,
          rewardCallRatio: o.rewardCallRatio || 0,
          isActive: true,
          capabilities: [],
        })) as any;
      } catch { /* no live data either */ }
    }

    let topOrchestrators = orchestratorData.map((o) => ({
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

    const allDelegatorZero = topOrchestrators.every((o) => o.delegatorCount === 0);
    const allVolumeZero = topOrchestrators.every((o) => o.totalVolumeETH === '0');
    if (allDelegatorZero || allVolumeZero) {
      try {
        const liveOrchs = await getOrchestrators();
        const liveMap = new Map(liveOrchs.map((o) => [o.address.toLowerCase(), o]));
        topOrchestrators = topOrchestrators.map((o) => {
          const live = liveMap.get(o.address.toLowerCase());
          if (!live) return o;
          return {
            ...o,
            delegatorCount: o.delegatorCount || live.delegatorCount,
            totalVolumeETH: o.totalVolumeETH === '0' ? (live.totalVolumeETH || '0') : o.totalVolumeETH,
            thirtyDayVolumeETH: o.thirtyDayVolumeETH === '0' ? (live.thirtyDayVolumeETH || '0') : o.thirtyDayVolumeETH,
            rewardCallRatio: o.rewardCallRatio || live.rewardCallRatio || 0,
          };
        });
      } catch { /* live enrichment failed */ }
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
