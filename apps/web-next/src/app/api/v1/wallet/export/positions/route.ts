/**
 * Export Positions API
 * GET /api/v1/wallet/export/positions?format=csv|json
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

    const format = request.nextUrl.searchParams.get('format') || 'csv';

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
    });

    const addrStrings = addresses.map(a => a.address);
    const stakingStates = await prisma.walletStakingState.findMany({
      where: { address: { in: addrStrings } },
    });
    const stateMap = new Map(stakingStates.map(s => [s.address, s]));

    const positions = addresses
      .filter(addr => stateMap.has(addr.address))
      .map(addr => {
        const s = stateMap.get(addr.address)!;
        return {
          address: addr.address,
          label: addr.label || '',
          chainId: addr.chainId,
          orchestrator: s.delegatedTo || '',
          stakedAmount: s.stakedAmount,
          pendingRewards: s.pendingRewards,
          pendingFees: s.pendingFees,
          startRound: s.startRound || '',
        };
      });

    if (format === 'json') {
      return new NextResponse(JSON.stringify(positions, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="positions-${dateStamp()}.json"`,
        },
      });
    }

    const header = 'Address,Label,Chain ID,Orchestrator,Staked Amount,Pending Rewards,Pending Fees,Start Round';
    const rows = positions.map(p =>
      [p.address, csvEscape(p.label), p.chainId, p.orchestrator, p.stakedAmount, p.pendingRewards, p.pendingFees, p.startRound].join(',')
    );

    return new NextResponse(`${header}\n${rows.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="positions-${dateStamp()}.csv"`,
      },
    });
  } catch (err) {
    console.error('Error exporting positions:', err);
    return errors.internal('Failed to export positions');
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
