/**
 * P&L export endpoint (S13)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const format = request.nextUrl.searchParams.get('format') || 'json';
    const startDate = request.nextUrl.searchParams.get('startDate');
    const endDate = request.nextUrl.searchParams.get('endDate');

    const now = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getTime() - 365 * 86400000);

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      include: {
        stakingStates: true,
        transactions: {
          where: { status: 'confirmed', timestamp: { gte: start, lte: now } },
          select: { type: true, value: true, gasUsed: true, gasPrice: true },
        },
      },
    });

    const rows = [];
    let totalBonded = 0n;
    let totalRewards = 0n;
    let totalFees = 0n;
    let totalGas = 0n;

    for (const addr of addresses) {
      for (const state of addr.stakingStates) {
        const bonded = BigInt(state.stakedAmount || '0');
        const rewards = BigInt(state.pendingRewards || '0');
        const fees = BigInt(state.pendingFees || '0');

        let addrGas = 0n;
        for (const tx of addr.transactions) {
          addrGas += BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0');
        }

        const netReturn = rewards + fees;
        rows.push({
          address: addr.address,
          orchestrator: state.delegatedTo || 'Unknown',
          bondedAmount: bonded.toString(),
          totalRewardsEarned: rewards.toString(),
          totalFeesEarned: fees.toString(),
          totalGasCostEth: (Number(addrGas) / 1e18).toFixed(8),
          netReturnLpt: netReturn.toString(),
          netReturnPct: bonded > 0n ? parseFloat(((Number(netReturn) / Number(bonded)) * 100).toFixed(4)) : 0,
          periodStart: start.toISOString(),
          periodEnd: now.toISOString(),
        });

        totalBonded += bonded;
        totalRewards += rewards;
        totalFees += fees;
        totalGas += addrGas;
      }
    }

    const pnl = {
      rows,
      totals: {
        totalBonded: totalBonded.toString(),
        totalRewards: totalRewards.toString(),
        totalFees: totalFees.toString(),
        totalGas: (Number(totalGas) / 1e18).toFixed(8),
        netReturn: (totalRewards + totalFees).toString(),
      },
    };

    if (format === 'csv') {
      const header = 'Address,Orchestrator,Bonded (wei),Rewards (wei),Fees (wei),Gas (ETH),Net Return (wei),Net Return %,Start,End';
      const body = rows.map(r =>
        [r.address, r.orchestrator, r.bondedAmount, r.totalRewardsEarned, r.totalFeesEarned, r.totalGasCostEth, r.netReturnLpt, r.netReturnPct, r.periodStart, r.periodEnd].join(',')
      ).join('\n');
      return new NextResponse(`${header}\n${body}`, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=wallet-pnl.csv',
        },
      });
    }

    return success(pnl);
  } catch (err) {
    console.error('P&L export error:', err);
    return errors.internal('Failed to export P&L');
  }
}
