/**
 * Vercel Cron trigger for updating unbonding lock statuses
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return errors.internal('Cron secret not configured');
  if (secret !== cronSecret) return errors.unauthorized('Invalid cron secret');

  try {
    // For now use a simple heuristic - in production this would query the subgraph
    const result = await prisma.walletUnbondingLock.updateMany({
      where: { status: 'pending' },
      data: { status: 'withdrawable' },
    });

    return success({ updated: result.count });
  } catch (err) {
    console.error('Cron unbonding error:', err);
    return errors.internal('Unbonding update job failed');
  }
}
