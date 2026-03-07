/**
 * Export Leaderboard API
 * GET /api/v1/wallet/export/leaderboard?format=csv|json
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

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      orderBy: { totalStake: 'desc' },
    });

    if (format === 'json') {
      return new NextResponse(JSON.stringify(orchestrators, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="leaderboard-${dateStamp()}.json"`,
        },
      });
    }

    const header = 'Address,Name,Reward Cut (%),Fee Share (%),Total Stake,Active,Service URI,Last Synced';
    const rows = orchestrators.map(o =>
      [
        o.address,
        csvEscape(o.name || ''),
        (o.rewardCut / 10000).toFixed(2),
        (o.feeShare / 10000).toFixed(2),
        o.totalStake,
        o.isActive,
        csvEscape(o.serviceUri || ''),
        o.lastSynced.toISOString(),
      ].join(',')
    );

    return new NextResponse(`${header}\n${rows.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="leaderboard-${dateStamp()}.csv"`,
      },
    });
  } catch (err) {
    console.error('Error exporting leaderboard:', err);
    return errors.internal('Failed to export leaderboard');
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
