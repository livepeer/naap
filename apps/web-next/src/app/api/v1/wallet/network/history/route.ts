/**
 * Network history endpoint — DB snapshots with subgraph fallback.
 * Includes protocolStatus from live subgraph data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getProtocol, getNetworkDays } from '@/lib/wallet/subgraph';

function parseLpt(v: string): number {
  if (!v || v === '0') return 0;
  if (v.includes('.')) return parseFloat(v);
  return Number(BigInt(v)) / 1e18;
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const limit = Math.min(
      parseInt(request.nextUrl.searchParams.get('limit') || '90', 10),
      365,
    );

    const [protocol, dbSnapshots] = await Promise.all([
      getProtocol().catch(() => null),
      prisma.walletNetworkSnapshot.findMany({
        orderBy: { round: 'asc' },
        take: limit,
      }),
    ]);

    const totalSupplyLpt = parseLpt(protocol?.totalSupply || '0');
    const totalBondedLpt = parseLpt(protocol?.totalActiveStake || '0');

    const protocolStatus = {
      currentRound: protocol?.currentRound || 0,
      roundLength: protocol?.roundLength || 5760,
      participationRate: protocol?.participationRate || 0,
      inflation: protocol?.inflation || '0',
      activeOrchestrators: protocol?.activeTranscoderCount || 0,
      delegatorsCount: protocol?.delegatorsCount || 0,
      totalSupply: totalSupplyLpt > 0 ? `${(totalSupplyLpt / 1e6).toFixed(1)}m` : 'N/A',
      totalSupplyRaw: totalSupplyLpt,
      totalBonded: totalBondedLpt > 0 ? `${(totalBondedLpt / 1e6).toFixed(2)}m` : 'N/A',
      totalBondedRaw: totalBondedLpt,
      totalVolumeETH: protocol?.totalVolumeETH || '0',
      totalVolumeUSD: protocol?.totalVolumeUSD || '0',
    };

    if (dbSnapshots.length > 0) {
      const dataPoints = dbSnapshots.map(s => ({
        round: s.round,
        totalBonded: s.totalBonded,
        participationRate: s.participationRate,
        inflation: s.inflation,
        activeOrchestrators: s.activeOrchestrators,
        delegatorsCount: s.delegatorsCount,
        avgRewardCut: s.avgRewardCut,
        avgFeeShare: s.avgFeeShare,
        snapshotAt: s.snapshotAt.toISOString(),
      }));

      const first = dbSnapshots[0];
      const last = dbSnapshots[dbSnapshots.length - 1];

      return NextResponse.json({
        data: {
          protocolStatus,
          dataPoints,
          summary: {
            bondedChange: (BigInt(last.totalBonded || '0') - BigInt(first.totalBonded || '0')).toString(),
            participationChange: parseFloat((last.participationRate - first.participationRate).toFixed(2)),
            orchestratorCountChange: last.activeOrchestrators - first.activeOrchestrators,
            periodStart: first.snapshotAt.toISOString(),
            periodEnd: last.snapshotAt.toISOString(),
          },
        },
      });
    }

    let subgraphDays: any[] = [];
    try {
      subgraphDays = await getNetworkDays(limit);
    } catch {
      // subgraph unavailable
    }

    const toDate = (ts: number) => new Date(ts * 1000).toISOString();
    const toInt = (v: string | number) => typeof v === 'string' ? parseInt(v, 10) || 0 : v;

    if (subgraphDays.length >= 2) {
      const dataPoints = subgraphDays.map(d => ({
        round: d.date,
        totalBonded: '0',
        participationRate: parseFloat(d.participationRate) * 100,
        inflation: d.inflation,
        activeOrchestrators: toInt(d.activeTranscoderCount),
        delegatorsCount: toInt(d.delegatorsCount),
        volumeETH: d.volumeETH,
        volumeUSD: d.volumeUSD,
        avgRewardCut: 0,
        avgFeeShare: 0,
        snapshotAt: toDate(d.date),
      }));

      return NextResponse.json({
        data: {
          protocolStatus,
          dataPoints,
          summary: {
            participationChange: (parseFloat(subgraphDays[0].participationRate) - parseFloat(subgraphDays[subgraphDays.length - 1].participationRate)) * 100,
            orchestratorCountChange: toInt(subgraphDays[0].activeTranscoderCount) - toInt(subgraphDays[subgraphDays.length - 1].activeTranscoderCount),
            bondedChange: '0',
            periodStart: toDate(subgraphDays[subgraphDays.length - 1].date),
            periodEnd: toDate(subgraphDays[0].date),
          },
        },
      });
    }

    const totalStakeFormatted = Math.round(totalBondedLpt).toString();
    return NextResponse.json({
      data: {
        protocolStatus,
        dataPoints: [{
          round: protocol?.currentRound || 0,
          totalBonded: totalStakeFormatted,
          participationRate: protocol?.participationRate || 0,
          inflation: protocol?.inflation || '0',
          activeOrchestrators: protocol?.activeTranscoderCount || 0,
          delegatorsCount: protocol?.delegatorsCount || 0,
          avgRewardCut: 0,
          avgFeeShare: 0,
          snapshotAt: protocol?.lastUpdated || new Date().toISOString(),
        }],
        summary: {
          bondedChange: totalStakeFormatted,
          participationChange: 0,
          orchestratorCountChange: protocol?.activeTranscoderCount || 0,
          periodStart: protocol?.lastUpdated || new Date().toISOString(),
          periodEnd: protocol?.lastUpdated || new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.error('Network history error:', err);
    return errors.internal('Failed to fetch network history');
  }
}
